//! Tessellated sweeps for the mesh/CSG (WASM) kernel: extrude or revolve a
//! simple profile ring into a solid, mirroring the TypeScript `meshSweep.ts` so
//! the fast kernel handles the common extrude/revolve cases without B-rep. Only
//! single-ring profiles (circle/rect/polygon) are tessellated; curved or
//! combined profiles route to B-rep.

use crate::csg::{Csg, Polygon, Vec3, Vertex};
use crate::opgraph_gen::OpNode;

type Pt = (f64, f64);
const DEG: f64 = std::f64::consts::PI / 180.0;

/// Signed area of a ring (shoelace); positive is counter-clockwise.
fn signed_area(ring: &[Pt]) -> f64 {
    let n = ring.len();
    let mut a = 0.0;
    for i in 0..n {
        let (x1, y1) = ring[i];
        let (x2, y2) = ring[(i + 1) % n];
        a += x1 * y2 - x2 * y1;
    }
    a / 2.0
}

/// Is point p inside triangle a,b,c (inclusive)?
fn point_in_tri(p: Pt, a: Pt, b: Pt, c: Pt) -> bool {
    let d = |u: Pt, v: Pt, w: Pt| (u.0 - w.0) * (v.1 - w.1) - (v.0 - w.0) * (u.1 - w.1);
    let d1 = d(p, a, b);
    let d2 = d(p, b, c);
    let d3 = d(p, c, a);
    let neg = d1 < 0.0 || d2 < 0.0 || d3 < 0.0;
    let pos = d1 > 0.0 || d2 > 0.0 || d3 > 0.0;
    !(neg && pos)
}

/// Ear-clip a simple polygon into triangles (index triples into `ring`).
fn triangulate(ring: &[Pt]) -> Vec<[usize; 3]> {
    let n = ring.len();
    if n < 3 {
        return Vec::new();
    }
    let mut idx: Vec<usize> = (0..n).collect();
    if signed_area(ring) < 0.0 {
        idx.reverse();
    }
    let mut tris: Vec<[usize; 3]> = Vec::new();
    let mut guard = 0;
    while idx.len() > 3 && guard < n * n {
        guard += 1;
        let mut clipped = false;
        for i in 0..idx.len() {
            let ia = idx[(i + idx.len() - 1) % idx.len()];
            let ib = idx[i];
            let ic = idx[(i + 1) % idx.len()];
            let a = ring[ia];
            let b = ring[ib];
            let c = ring[ic];
            let cross = (b.0 - a.0) * (c.1 - a.1) - (b.1 - a.1) * (c.0 - a.0);
            if cross <= 0.0 {
                continue;
            }
            let mut has_inside = false;
            for &j in &idx {
                if j == ia || j == ib || j == ic {
                    continue;
                }
                if point_in_tri(ring[j], a, b, c) {
                    has_inside = true;
                    break;
                }
            }
            if has_inside {
                continue;
            }
            tris.push([ia, ib, ic]);
            idx.remove(i);
            clipped = true;
            break;
        }
        if !clipped {
            break;
        }
    }
    if idx.len() == 3 {
        tris.push([idx[0], idx[1], idx[2]]);
    }
    tris
}

/// Cap polygons from a ring of 3D points and triangle indices.
fn cap_polys(points: &[Vec3], tris: &[[usize; 3]], normal: Vec3, flip: bool) -> Vec<Polygon> {
    tris.iter()
        .map(|&[i, j, k]| {
            let order = if flip { [k, j, i] } else { [i, j, k] };
            Polygon::new(order.iter().map(|&n| Vertex::new(points[n], normal)).collect())
        })
        .collect()
}

/// Linear extrude a profile ring (z=0 to z=height) with twist (deg) and end scale.
pub fn extrude_profile(ring: &[Pt], height: f64, twist: f64, scale: f64) -> Result<Csg, String> {
    if ring.len() < 3 {
        return Err("extrude needs a profile with 3+ points".to_string());
    }
    let ccw = signed_area(ring) >= 0.0;
    let tris = triangulate(ring);

    // A twist makes walls non-planar, so slice the height into near-planar
    // layers (<= ~10 deg each); a pure taper keeps planar walls (one layer)
    let layers = if twist == 0.0 {
        1
    } else {
        ((twist.abs() / 10.0).ceil() as usize).max(1)
    };
    let ring_at = |f: f64| -> Vec<Vec3> {
        let tw = twist * DEG * f;
        let (cos, sin) = (tw.cos(), tw.sin());
        let s = 1.0 + (scale - 1.0) * f;
        ring.iter()
            .map(|&(x, y)| {
                let (sx, sy) = (x * s, y * s);
                Vec3::new(sx * cos - sy * sin, sx * sin + sy * cos, height * f)
            })
            .collect()
    };
    let levels: Vec<Vec<Vec3>> = (0..=layers).map(|l| ring_at(l as f64 / layers as f64)).collect();

    let mut polys: Vec<Polygon> = Vec::new();
    polys.extend(cap_polys(&levels[0], &tris, Vec3::new(0.0, 0.0, -1.0), ccw));
    polys.extend(cap_polys(&levels[layers], &tris, Vec3::new(0.0, 0.0, 1.0), !ccw));

    let n = ring.len();
    for l in 0..layers {
        for i in 0..n {
            let j = (i + 1) % n;
            let (b0, b1) = (levels[l][i], levels[l][j]);
            let (t0, t1) = (levels[l + 1][i], levels[l + 1][j]);
            let mut normal = b1.minus(b0).cross(t0.minus(b0)).unit();
            if ccw {
                normal = normal.times(-1.0);
            }
            let quad = if ccw { [b0, t0, t1, b1] } else { [b0, b1, t1, t0] };
            polys.push(Polygon::new(
                quad.iter().map(|&p| Vertex::new(p, normal)).collect(),
            ));
        }
    }
    Ok(Csg::from_polygons(polys))
}

/// Revolve a profile ring (x=radius, y=height) about Z by `angle` deg.
pub fn revolve_profile(ring: &[Pt], angle: f64, segments: i32) -> Result<Csg, String> {
    if ring.len() < 3 {
        return Err("revolve needs a profile with 3+ points".to_string());
    }
    let steps = segments.max(3) as usize;
    let full = (angle % 360.0).abs() < 1e-6 && angle != 0.0;
    let total = (if full { 360.0 } else { angle }) * DEG;

    let at = |p: Pt, t: f64| Vec3::new(p.0 * t.cos(), p.0 * t.sin(), p.1);

    let mut polys: Vec<Polygon> = Vec::new();
    let n = ring.len();
    for s in 0..steps {
        let t0 = (s as f64 / steps as f64) * total;
        let t1 = ((s + 1) as f64 / steps as f64) * total;
        for i in 0..n {
            let j = (i + 1) % n;
            if ring[i].0 == 0.0 && ring[j].0 == 0.0 {
                continue;
            }
            let a = at(ring[i], t0);
            let b = at(ring[j], t0);
            let c = at(ring[j], t1);
            let d = at(ring[i], t1);
            let normal = b.minus(a).cross(d.minus(a)).unit();
            polys.push(Polygon::new(
                [a, b, c, d].iter().map(|&p| Vertex::new(p, normal)).collect(),
            ));
        }
    }

    if !full {
        let tris = triangulate(ring);
        let start_pts: Vec<Vec3> = ring.iter().map(|&p| at(p, 0.0)).collect();
        let end_pts: Vec<Vec3> = ring.iter().map(|&p| at(p, total)).collect();
        let ccw = signed_area(ring) >= 0.0;
        let n_start = Vec3::new(0.0, -1.0, 0.0);
        let n_end = Vec3::new(total.sin(), -total.cos(), 0.0).unit();
        polys.extend(cap_polys(&start_pts, &tris, n_start, !ccw));
        polys.extend(cap_polys(&end_pts, &tris, n_end, ccw));
    }
    Ok(Csg::from_polygons(polys))
}

/// A profile ring for a simple sketch primitive, or None when it needs B-rep.
pub fn profile_ring(node: &OpNode) -> Option<Vec<Pt>> {
    match node {
        OpNode::Circle2d { r, segments } => {
            let seg = (*segments).max(3) as usize;
            Some(
                (0..seg)
                    .map(|i| {
                        let a = (i as f64 / seg as f64) * std::f64::consts::PI * 2.0;
                        (r * a.cos(), r * a.sin())
                    })
                    .collect(),
            )
        }
        OpNode::Rect2d { size, center } => {
            let (w, h) = (size[0], size[1]);
            Some(if *center {
                vec![
                    (-w / 2.0, -h / 2.0),
                    (w / 2.0, -h / 2.0),
                    (w / 2.0, h / 2.0),
                    (-w / 2.0, h / 2.0),
                ]
            } else {
                vec![(0.0, 0.0), (w, 0.0), (w, h), (0.0, h)]
            })
        }
        OpNode::Polygon2d { points } => {
            if points.len() < 6 || points.len() % 2 != 0 {
                return None;
            }
            Some(points.chunks(2).map(|c| (c[0], c[1])).collect())
        }
        // A 2D transform recurses into its child ring and maps each point,
        // mirroring the TS meshSweep point-math. translate/scale/mirror are
        // algebraic (add/multiply/sqrt), so the two kernels agree bit for bit;
        // rotate goes through sin/cos, which are not correctly-rounded, so it
        // matches within a floating-point tolerance. A curved/combined child
        // returns None and routes to B-rep
        OpNode::Translate2d { v, child } => {
            let ring = profile_ring(child)?;
            let (dx, dy) = (v[0], v[1]);
            Some(ring.iter().map(|&(x, y)| (x + dx, y + dy)).collect())
        }
        OpNode::Rotate2d { angle, child } => {
            let ring = profile_ring(child)?;
            let a = *angle * DEG;
            let (cos, sin) = (a.cos(), a.sin());
            Some(
                ring.iter()
                    .map(|&(x, y)| (x * cos - y * sin, x * sin + y * cos))
                    .collect(),
            )
        }
        OpNode::Scale2d { factor, child } => {
            let ring = profile_ring(child)?;
            Some(ring.iter().map(|&(x, y)| (x * factor, y * factor)).collect())
        }
        OpNode::Mirror2d { normal, child } => {
            let ring = profile_ring(child)?;
            let (nx, ny) = (normal[0], normal[1]);
            let len = (nx * nx + ny * ny).sqrt();
            let len = if len == 0.0 { 1.0 } else { len };
            let (ux, uy) = (nx / len, ny / len);
            let mut reflected: Vec<Pt> = ring
                .iter()
                .map(|&(x, y)| {
                    let d = 2.0 * (x * ux + y * uy);
                    (x - d * ux, y - d * uy)
                })
                .collect();
            // A reflection flips orientation, so reverse the ring winding
            reflected.reverse();
            Some(reflected)
        }
        _ => None,
    }
}
