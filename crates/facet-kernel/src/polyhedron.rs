//! Decoding and triangulation for `polyhedron` (OpenSCAD's polyhedron): an
//! explicit mesh given as a flat list of x,y,z point triples plus a flat,
//! count-prefixed face list. A Rust port of the app's `src/facet/polyhedron.ts`
//! that mirrors it step for step so a polyhedron decodes and triangulates
//! identically in every kernel; a divergence would regress the WASM kernel
//! against the TS mesh kernel.
//!
//! Winding convention (OpenSCAD's): each face lists its vertices so that, seen
//! from OUTSIDE the solid, they run in a consistent rotational order, so a flat
//! normal `(p1 - p0) x (p2 - p0)` from that winding points outward.
//!
//! The op-graph carries both lists as `f64` (JSON numbers), so a face count or
//! index must be a non-negative integer value; a fractional or negative value
//! is rejected the same way the TS `Number.isInteger` guards reject it.

/// A polyhedron decoded into point triples and per-face vertex-index lists.
#[derive(Debug)]
pub struct DecodedPolyhedron {
    pub points: Vec<[f64; 3]>,
    pub faces: Vec<Vec<usize>>,
}

/// Read an `f64` that must be a non-negative integer vertex index in range
fn to_index(x: f64, point_count: usize) -> Result<usize, String> {
    if !x.is_finite() || x.fract() != 0.0 || x < 0.0 {
        return Err("polyhedron face has an out-of-range vertex index".to_string());
    }
    let i = x as usize;
    if i >= point_count {
        return Err("polyhedron face has an out-of-range vertex index".to_string());
    }
    Ok(i)
}

/// Decode flat `points` (x,y,z triples) and flat, count-prefixed `faces`
/// ([n, i0..i(n-1), m, j0..]) into point triples and index lists. Mirrors the
/// TS `decodePolyhedron` validation exactly
pub fn decode_polyhedron(points: &[f64], faces: &[f64]) -> Result<DecodedPolyhedron, String> {
    if !points.len().is_multiple_of(3) {
        return Err(
            "polyhedron points must be a flat list of x,y,z triples (length divisible by 3)"
                .to_string(),
        );
    }
    let point_count = points.len() / 3;
    let mut point_list: Vec<[f64; 3]> = Vec::with_capacity(point_count);
    let mut i = 0;
    while i < points.len() {
        point_list.push([points[i], points[i + 1], points[i + 2]]);
        i += 3;
    }

    let mut face_list: Vec<Vec<usize>> = Vec::new();
    let mut j = 0;
    while j < faces.len() {
        let n_raw = faces[j];
        j += 1;
        if !n_raw.is_finite() || n_raw.fract() != 0.0 || n_raw < 3.0 {
            return Err("polyhedron needs at least 3 vertices per face".to_string());
        }
        // Reject a face count larger than the vertices that remain BEFORE the
        // `as usize` cast: a huge-but-integral f64 (e.g. 1e20) saturates the
        // cast to usize::MAX and `j + n` would overflow and trap. Comparing in
        // f64 first gives the same clean "truncated" error the TS kernel throws
        if n_raw > (faces.len() - j) as f64 {
            return Err(
                "polyhedron face list is truncated: a face claims more vertices than remain"
                    .to_string(),
            );
        }
        let n = n_raw as usize;
        let mut face: Vec<usize> = Vec::with_capacity(n);
        for k in 0..n {
            face.push(to_index(faces[j + k], point_count)?);
        }
        face_list.push(face);
        j += n;
    }
    Ok(DecodedPolyhedron { points: point_list, faces: face_list })
}

/// Fan-triangulate one face into triangle-index triples: `(i0, ik, ik+1)` for
/// k in 1..n-1, preserving the face winding so each triangle faces outward
pub fn triangulate_face(face: &[usize]) -> Vec<[usize; 3]> {
    let mut tris: Vec<[usize; 3]> = Vec::new();
    if face.len() >= 2 {
        for k in 1..face.len() - 1 {
            tris.push([face[0], face[k], face[k + 1]]);
        }
    }
    tris
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_a_count_prefixed_face_list() {
        let points = [0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0];
        let faces = [
            3.0, 0.0, 2.0, 1.0, 3.0, 0.0, 1.0, 3.0, 3.0, 1.0, 2.0, 3.0, 3.0, 2.0, 0.0, 3.0,
        ];
        let d = decode_polyhedron(&points, &faces).expect("decode");
        assert_eq!(d.points.len(), 4);
        assert_eq!(d.faces, vec![vec![0, 2, 1], vec![0, 1, 3], vec![1, 2, 3], vec![2, 0, 3]]);
    }

    #[test]
    fn out_of_range_index_errors() {
        let points = [0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0];
        let faces = [3.0, 0.0, 1.0, 3.0];
        assert!(decode_polyhedron(&points, &faces).is_err());
    }

    #[test]
    fn fewer_than_three_vertices_errors() {
        let points = [0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0];
        let faces = [2.0, 0.0, 1.0];
        assert!(decode_polyhedron(&points, &faces).is_err());
    }

    #[test]
    fn points_not_multiple_of_three_errors() {
        let points = [0.0, 0.0, 0.0, 1.0, 0.0];
        let faces = [3.0, 0.0, 1.0, 2.0];
        assert!(decode_polyhedron(&points, &faces).is_err());
    }

    #[test]
    fn fans_a_quad_into_two_triangles() {
        assert_eq!(triangulate_face(&[0, 1, 2, 3]), vec![[0, 1, 2], [0, 2, 3]]);
    }

    #[test]
    fn astronomically_large_face_count_errors_as_truncated_without_trapping() {
        let points = [0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0];
        // 1e20 is a finite integral f64 that clears the >= 3 guard; it must be
        // rejected in f64 before any `as usize` cast could saturate and overflow
        let faces = [1e20, 0.0, 1.0, 2.0];
        let err = decode_polyhedron(&points, &faces).expect_err("must reject huge count");
        assert!(err.contains("truncated"), "unexpected message: {err}");
    }
}
