//! 3D convex hull of a point cloud (a Rust port of the app's `src/facet/hull.ts`).
//!
//! `hull()` runs this in both the mesh and WASM kernels, so this must mirror the
//! TypeScript routine step for step (same comparisons, tie-breaks, and epsilon)
//! to produce bit-identical triangles on the same cloud; a divergence would
//! regress the WASM kernel against the TS one. See hull.ts for the algorithm.

use std::collections::HashSet;

/// A triangle-index triple into the input point cloud.
pub type Tri = [usize; 3];

// Distance tolerance mirroring hull.ts: below it the seed is degenerate and a
// point counts as not visible. A true distance, so the normal is normalized
const EPS: f64 = 1e-9;

fn sub(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

fn cross(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

fn dot(a: [f64; 3], b: [f64; 3]) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

/// A hull face: three vertex indices plus its outward unit plane (`n·x = w`)
struct Face {
    v: [usize; 3],
    n: [f64; 3],
    w: f64,
}

/// Build a face from three vertices, flipped so its unit normal points away
/// from `interior`. Mirrors the `makeFace` closure in hull.ts
fn make_face(points: &[[f64; 3]], interior: [f64; 3], a: usize, b: usize, c: usize) -> Face {
    let raw = cross(sub(points[b], points[a]), sub(points[c], points[a]));
    let len = dot(raw, raw).sqrt();
    // A correct hull never cones to a zero-area triangle, but guard the division
    // so a pathological cloud cannot divide by ~0 and inject a NaN normal that
    // (NaN compares false) is never deleted and rides into output. len > EPS
    // keeps the exact `raw / len` path, bit-identical to before
    let n = if len > EPS {
        [raw[0] / len, raw[1] / len, raw[2] / len]
    } else {
        [0.0, 0.0, 0.0]
    };
    let w = dot(n, points[a]);
    if dot(n, interior) - w > 0.0 {
        Face { v: [a, c, b], n: [-n[0], -n[1], -n[2]], w: -w }
    } else {
        Face { v: [a, b, c], n, w }
    }
}

/// Convex hull of `points`, returned as outward-facing triangle-index triples.
/// Errs when the cloud has fewer than four non-coplanar points
pub fn hull3d(points: &[[f64; 3]]) -> Result<Vec<Tri>, String> {
    let n = points.len();
    let degenerate = || "hull needs at least 4 non-coplanar points".to_string();
    if n < 4 {
        return Err(degenerate());
    }

    // 1) p0: the lexicographically smallest point (min x, then y, then z)
    let mut i0 = 0;
    for i in 1..n {
        let a = points[i];
        let b = points[i0];
        if a[0] < b[0] || (a[0] == b[0] && (a[1] < b[1] || (a[1] == b[1] && a[2] < b[2]))) {
            i0 = i;
        }
    }

    // 2) p1: the point farthest from p0 (ties keep the lower index)
    let mut i1 = 0;
    let mut best = -1.0;
    for i in 0..n {
        if i == i0 {
            continue;
        }
        let d = sub(points[i], points[i0]);
        let dist2 = dot(d, d);
        if dist2 > best {
            best = dist2;
            i1 = i;
        }
    }
    if best <= EPS * EPS {
        return Err(degenerate());
    }

    // 3) p2: the point farthest from the line p0-p1 (perpendicular distance)
    let e01 = sub(points[i1], points[i0]);
    let e01_len2 = dot(e01, e01);
    let mut i2 = 0;
    best = -1.0;
    for i in 0..n {
        if i == i0 || i == i1 {
            continue;
        }
        let c = cross(sub(points[i], points[i0]), e01);
        let perp2 = dot(c, c) / e01_len2;
        if perp2 > best {
            best = perp2;
            i2 = i;
        }
    }
    if best <= EPS * EPS {
        return Err(degenerate());
    }

    // 4) p3: the point farthest from the plane through p0, p1, p2
    let plane_n = cross(sub(points[i1], points[i0]), sub(points[i2], points[i0]));
    let plane_n_len = dot(plane_n, plane_n).sqrt();
    let mut i3 = 0;
    best = -1.0;
    for i in 0..n {
        if i == i0 || i == i1 || i == i2 {
            continue;
        }
        let d = dot(plane_n, sub(points[i], points[i0])).abs() / plane_n_len;
        if d > best {
            best = d;
            i3 = i;
        }
    }
    if best <= EPS {
        return Err(degenerate());
    }

    // The seed centroid stays strictly inside the hull for its whole life, so
    // every face can be oriented outward against it with no winding bookkeeping
    let interior = [
        (points[i0][0] + points[i1][0] + points[i2][0] + points[i3][0]) / 4.0,
        (points[i0][1] + points[i1][1] + points[i2][1] + points[i3][1]) / 4.0,
        (points[i0][2] + points[i1][2] + points[i2][2] + points[i3][2]) / 4.0,
    ];

    let mut faces: Vec<Face> = vec![
        make_face(points, interior, i0, i1, i2),
        make_face(points, interior, i0, i1, i3),
        make_face(points, interior, i0, i2, i3),
        make_face(points, interior, i1, i2, i3),
    ];

    let seeded: HashSet<usize> = [i0, i1, i2, i3].into_iter().collect();

    for pi in 0..n {
        if seeded.contains(&pi) {
            continue;
        }
        let p = points[pi];
        // A face is visible if the point lies strictly in front of its outward
        // plane; a coplanar point is never visible, so no flat sliver faces and
        // points interior to a face are dropped
        let visible: Vec<bool> = faces.iter().map(|f| dot(f.n, p) - f.w > EPS).collect();
        if !visible.iter().any(|&v| v) {
            continue;
        }

        // Directed edges of the visible region; an edge whose reverse twin is
        // not also visible borders a kept face, so it lies on the horizon loop
        let mut visible_edges: HashSet<(usize, usize)> = HashSet::new();
        for (fi, face) in faces.iter().enumerate() {
            if !visible[fi] {
                continue;
            }
            let [a, b, c] = face.v;
            visible_edges.insert((a, b));
            visible_edges.insert((b, c));
            visible_edges.insert((c, a));
        }
        let mut horizon: Vec<(usize, usize)> = Vec::new();
        for (fi, face) in faces.iter().enumerate() {
            if !visible[fi] {
                continue;
            }
            let [a, b, c] = face.v;
            for &(u, v) in &[(a, b), (b, c), (c, a)] {
                if !visible_edges.contains(&(v, u)) {
                    horizon.push((u, v));
                }
            }
        }

        let mut kept: Vec<Face> = Vec::new();
        for (fi, face) in faces.into_iter().enumerate() {
            if !visible[fi] {
                kept.push(face);
            }
        }
        for (u, v) in horizon {
            kept.push(make_face(points, interior, u, v, pi));
        }
        faces = kept;
    }

    Ok(faces.iter().map(|f| f.v).collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    fn cube_corners() -> Vec<[f64; 3]> {
        let mut pts = Vec::new();
        for x in [-1.0, 1.0] {
            for y in [-1.0, 1.0] {
                for z in [-1.0, 1.0] {
                    pts.push([x, y, z]);
                }
            }
        }
        pts
    }

    #[test]
    fn tetrahedron_is_its_own_hull() {
        let tris = hull3d(&[[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]])
            .expect("hull");
        assert_eq!(tris.len(), 4);
    }

    #[test]
    fn cube_corners_hull_to_twelve_triangles_over_eight_vertices() {
        let tris = hull3d(&cube_corners()).expect("hull");
        assert_eq!(tris.len(), 12);
        let verts: HashSet<usize> = tris.iter().flatten().copied().collect();
        assert_eq!(verts.len(), 8);
    }

    #[test]
    fn degenerate_clouds_error() {
        // Fewer than 4 points
        assert!(hull3d(&[[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0]]).is_err());
        // Collinear
        assert!(hull3d(&[
            [0.0, 0.0, 0.0],
            [1.0, 0.0, 0.0],
            [2.0, 0.0, 0.0],
            [3.0, 0.0, 0.0]
        ])
        .is_err());
        // Coplanar (a unit square in z = 0)
        assert!(hull3d(&[
            [0.0, 0.0, 0.0],
            [1.0, 0.0, 0.0],
            [1.0, 1.0, 0.0],
            [0.0, 1.0, 0.0]
        ])
        .is_err());
    }
}
