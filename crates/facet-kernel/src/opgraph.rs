//! Op-graph deserialization and evaluation (mirrors the TS meshKernel).

use serde::Deserialize;

use crate::csg::{Csg, Polygon, Vec3, Vertex};

#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "lowercase")]
pub enum OpNode {
    Cube { size: [f64; 3], center: bool },
    Sphere { r: f64, segments: u32 },
    Cylinder { r: f64, h: f64, segments: u32, center: bool },
    Translate { v: [f64; 3], child: Box<OpNode> },
    Rotate { deg: [f64; 3], child: Box<OpNode> },
    Scale { v: [f64; 3], child: Box<OpNode> },
    Union { children: Vec<OpNode> },
    Difference { children: Vec<OpNode> },
    Intersect { children: Vec<OpNode> },
}

pub fn eval_node(node: &OpNode) -> Csg {
    match node {
        OpNode::Cube { size, center } => {
            let radius = [size[0] / 2.0, size[1] / 2.0, size[2] / 2.0];
            let c = if *center { [0.0, 0.0, 0.0] } else { radius };
            csg_cube(c, radius)
        }
        OpNode::Sphere { r, segments } => {
            let stacks = ((*segments as f64 / 2.0).round() as u32).max(2);
            csg_sphere(*r, *segments, stacks)
        }
        OpNode::Cylinder { r, h, segments, center } => csg_cylinder(*r, *h, *center, *segments),
        OpNode::Translate { v, child } => {
            map_verts(&eval_node(child), |p| p.plus(Vec3::new(v[0], v[1], v[2])))
        }
        OpNode::Scale { v, child } => {
            map_verts(&eval_node(child), |p| Vec3::new(p.x * v[0], p.y * v[1], p.z * v[2]))
        }
        OpNode::Rotate { deg, child } => map_verts(&eval_node(child), |p| rotate_point(p, *deg)),
        OpNode::Union { children } => reduce_bool(children, |a, b| a.union(b)),
        OpNode::Difference { children } => reduce_bool(children, |a, b| a.subtract(b)),
        OpNode::Intersect { children } => reduce_bool(children, |a, b| a.intersect(b)),
    }
}

fn reduce_bool(children: &[OpNode], f: impl Fn(&Csg, &Csg) -> Csg) -> Csg {
    let mut iter = children.iter();
    let first = iter.next().expect("boolean op needs at least one child");
    let mut acc = eval_node(first);
    for child in iter {
        acc = f(&acc, &eval_node(child));
    }
    acc
}

fn map_verts(csg: &Csg, f: impl Fn(Vec3) -> Vec3) -> Csg {
    let polygons = csg
        .polygons
        .iter()
        .map(|poly| {
            let verts = poly
                .vertices
                .iter()
                .map(|v| Vertex::new(f(v.pos), v.normal))
                .collect();
            Polygon::new(verts)
        })
        .collect();
    Csg::from_polygons(polygons)
}

fn rotate_point(p: Vec3, deg: [f64; 3]) -> Vec3 {
    let d = std::f64::consts::PI / 180.0;
    let (mut x, mut y, mut z) = (p.x, p.y, p.z);
    let (cx, sx) = ((deg[0] * d).cos(), (deg[0] * d).sin());
    let (ny, nz) = (y * cx - z * sx, y * sx + z * cx);
    y = ny;
    z = nz;
    let (cy, sy) = ((deg[1] * d).cos(), (deg[1] * d).sin());
    let (nx, nz2) = (x * cy + z * sy, -x * sy + z * cy);
    x = nx;
    z = nz2;
    let (cz, sz) = ((deg[2] * d).cos(), (deg[2] * d).sin());
    let (nx2, ny2) = (x * cz - y * sz, x * sz + y * cz);
    Vec3::new(nx2, ny2, z)
}

fn csg_cube(center: [f64; 3], radius: [f64; 3]) -> Csg {
    let c = Vec3::new(center[0], center[1], center[2]);
    let faces: [([usize; 4], [f64; 3]); 6] = [
        ([0, 4, 6, 2], [-1.0, 0.0, 0.0]),
        ([1, 3, 7, 5], [1.0, 0.0, 0.0]),
        ([0, 1, 5, 4], [0.0, -1.0, 0.0]),
        ([2, 6, 7, 3], [0.0, 1.0, 0.0]),
        ([0, 2, 3, 1], [0.0, 0.0, -1.0]),
        ([4, 5, 7, 6], [0.0, 0.0, 1.0]),
    ];
    let polygons = faces
        .iter()
        .map(|(idx, n)| {
            let normal = Vec3::new(n[0], n[1], n[2]);
            let verts = idx
                .iter()
                .map(|&i| {
                    let pos = Vec3::new(
                        c.x + radius[0] * (2.0 * ((i & 1) != 0) as i32 as f64 - 1.0),
                        c.y + radius[1] * (2.0 * ((i & 2) != 0) as i32 as f64 - 1.0),
                        c.z + radius[2] * (2.0 * ((i & 4) != 0) as i32 as f64 - 1.0),
                    );
                    Vertex::new(pos, normal)
                })
                .collect();
            Polygon::new(verts)
        })
        .collect();
    Csg::from_polygons(polygons)
}

fn csg_sphere(r: f64, slices: u32, stacks: u32) -> Csg {
    let mut polygons: Vec<Polygon> = Vec::new();
    let vertex = |theta: f64, phi: f64, out: &mut Vec<Vertex>| {
        let t = theta * std::f64::consts::TAU;
        let p = phi * std::f64::consts::PI;
        let dir = Vec3::new(t.cos() * p.sin(), p.cos(), t.sin() * p.sin());
        out.push(Vertex::new(dir.times(r), dir));
    };
    for i in 0..slices {
        for j in 0..stacks {
            let mut verts: Vec<Vertex> = Vec::new();
            vertex(i as f64 / slices as f64, j as f64 / stacks as f64, &mut verts);
            if j > 0 {
                vertex((i + 1) as f64 / slices as f64, j as f64 / stacks as f64, &mut verts);
            }
            if j < stacks - 1 {
                vertex((i + 1) as f64 / slices as f64, (j + 1) as f64 / stacks as f64, &mut verts);
            }
            vertex(i as f64 / slices as f64, (j + 1) as f64 / stacks as f64, &mut verts);
            polygons.push(Polygon::new(verts));
        }
    }
    Csg::from_polygons(polygons)
}

fn csg_cylinder(r: f64, h: f64, center: bool, slices: u32) -> Csg {
    let z0 = if center { -h / 2.0 } else { 0.0 };
    let z1 = if center { h / 2.0 } else { h };
    let s = Vec3::new(0.0, 0.0, z0);
    let e = Vec3::new(0.0, 0.0, z1);
    let ray = e.minus(s);
    let axis_z = ray.unit();
    // Matches csg.js so side + cap normals face outward.
    let axis_x = Vec3::new(1.0, 0.0, 0.0);
    let axis_y = Vec3::new(0.0, -1.0, 0.0);
    let start = Vertex::new(s, axis_z.negated());
    let end = Vertex::new(e, axis_z);
    let point = |stack: f64, slice: f64, normal_blend: f64| -> Vertex {
        let angle = slice * std::f64::consts::TAU;
        let out = axis_x.times(angle.cos()).plus(axis_y.times(angle.sin()));
        let pos = s.plus(ray.times(stack)).plus(out.times(r));
        let normal = out.times(1.0 - normal_blend.abs()).plus(axis_z.times(normal_blend));
        Vertex::new(pos, normal)
    };
    let mut polygons: Vec<Polygon> = Vec::new();
    for i in 0..slices {
        let t0 = i as f64 / slices as f64;
        let t1 = (i + 1) as f64 / slices as f64;
        polygons.push(Polygon::new(vec![start, point(0.0, t0, -1.0), point(0.0, t1, -1.0)]));
        polygons.push(Polygon::new(vec![
            point(0.0, t1, 0.0),
            point(0.0, t0, 0.0),
            point(1.0, t0, 0.0),
            point(1.0, t1, 0.0),
        ]));
        polygons.push(Polygon::new(vec![end, point(1.0, t1, 1.0), point(1.0, t0, 1.0)]));
    }
    Csg::from_polygons(polygons)
}
