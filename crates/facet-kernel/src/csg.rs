//! Constructive Solid Geometry via BSP trees (Rust port of the app's csg.ts).

#[derive(Clone, Copy)]
pub struct Vec3 {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

impl Vec3 {
    pub fn new(x: f64, y: f64, z: f64) -> Self {
        Vec3 { x, y, z }
    }
    pub fn plus(self, a: Vec3) -> Vec3 {
        Vec3::new(self.x + a.x, self.y + a.y, self.z + a.z)
    }
    pub fn minus(self, a: Vec3) -> Vec3 {
        Vec3::new(self.x - a.x, self.y - a.y, self.z - a.z)
    }
    pub fn times(self, a: f64) -> Vec3 {
        Vec3::new(self.x * a, self.y * a, self.z * a)
    }
    pub fn dot(self, a: Vec3) -> f64 {
        self.x * a.x + self.y * a.y + self.z * a.z
    }
    pub fn cross(self, a: Vec3) -> Vec3 {
        Vec3::new(
            self.y * a.z - self.z * a.y,
            self.z * a.x - self.x * a.z,
            self.x * a.y - self.y * a.x,
        )
    }
    pub fn lerp(self, a: Vec3, t: f64) -> Vec3 {
        self.plus(a.minus(self).times(t))
    }
    pub fn length(self) -> f64 {
        self.dot(self).sqrt()
    }
    pub fn unit(self) -> Vec3 {
        self.times(1.0 / self.length())
    }
    pub fn negated(self) -> Vec3 {
        Vec3::new(-self.x, -self.y, -self.z)
    }
}

#[derive(Clone, Copy)]
pub struct Vertex {
    pub pos: Vec3,
    pub normal: Vec3,
}

impl Vertex {
    pub fn new(pos: Vec3, normal: Vec3) -> Self {
        Vertex { pos, normal }
    }
    fn interpolate(self, other: Vertex, t: f64) -> Vertex {
        Vertex::new(self.pos.lerp(other.pos, t), self.normal.lerp(other.normal, t))
    }
}

const EPSILON: f64 = 1e-5;
const COPLANAR: i32 = 0;
const FRONT: i32 = 1;
const BACK: i32 = 2;
const SPANNING: i32 = 3;

#[derive(Clone, Copy)]
pub struct Plane {
    pub normal: Vec3,
    pub w: f64,
}

impl Plane {
    pub fn from_points(a: Vec3, b: Vec3, c: Vec3) -> Plane {
        let n = b.minus(a).cross(c.minus(a)).unit();
        Plane { normal: n, w: n.dot(a) }
    }
    fn flip(&mut self) {
        self.normal = self.normal.negated();
        self.w = -self.w;
    }
    fn split_polygon(
        &self,
        polygon: &Polygon,
        coplanar_front: &mut Vec<Polygon>,
        coplanar_back: &mut Vec<Polygon>,
        front: &mut Vec<Polygon>,
        back: &mut Vec<Polygon>,
    ) {
        let mut polygon_type = 0;
        let mut types: Vec<i32> = Vec::with_capacity(polygon.vertices.len());
        for v in &polygon.vertices {
            let t = self.normal.dot(v.pos) - self.w;
            let ty = if t < -EPSILON {
                BACK
            } else if t > EPSILON {
                FRONT
            } else {
                COPLANAR
            };
            polygon_type |= ty;
            types.push(ty);
        }

        match polygon_type {
            x if x == COPLANAR => {
                if self.normal.dot(polygon.plane.normal) > 0.0 {
                    coplanar_front.push(polygon.clone());
                } else {
                    coplanar_back.push(polygon.clone());
                }
            }
            x if x == FRONT => front.push(polygon.clone()),
            x if x == BACK => back.push(polygon.clone()),
            _ => {
                let mut f: Vec<Vertex> = Vec::new();
                let mut b: Vec<Vertex> = Vec::new();
                let n = polygon.vertices.len();
                for i in 0..n {
                    let j = (i + 1) % n;
                    let ti = types[i];
                    let tj = types[j];
                    let vi = polygon.vertices[i];
                    let vj = polygon.vertices[j];
                    if ti != BACK {
                        f.push(vi);
                    }
                    if ti != FRONT {
                        b.push(vi);
                    }
                    if (ti | tj) == SPANNING {
                        let t = (self.w - self.normal.dot(vi.pos))
                            / self.normal.dot(vj.pos.minus(vi.pos));
                        let v = vi.interpolate(vj, t);
                        f.push(v);
                        b.push(v);
                    }
                }
                if f.len() >= 3 {
                    front.push(Polygon::new(f));
                }
                if b.len() >= 3 {
                    back.push(Polygon::new(b));
                }
            }
        }
    }
}

#[derive(Clone)]
pub struct Polygon {
    pub vertices: Vec<Vertex>,
    pub plane: Plane,
}

impl Polygon {
    pub fn new(vertices: Vec<Vertex>) -> Polygon {
        let plane = Plane::from_points(vertices[0].pos, vertices[1].pos, vertices[2].pos);
        Polygon { vertices, plane }
    }
    fn flip(&mut self) {
        self.vertices.reverse();
        for v in &mut self.vertices {
            v.normal = v.normal.negated();
        }
        self.plane.flip();
    }
}

#[derive(Default)]
struct Node {
    plane: Option<Plane>,
    front: Option<Box<Node>>,
    back: Option<Box<Node>>,
    polygons: Vec<Polygon>,
}

impl Node {
    fn from(polygons: Vec<Polygon>) -> Node {
        let mut node = Node::default();
        if !polygons.is_empty() {
            node.build(polygons);
        }
        node
    }

    fn invert(&mut self) {
        for p in &mut self.polygons {
            p.flip();
        }
        if let Some(pl) = &mut self.plane {
            pl.flip();
        }
        if let Some(f) = &mut self.front {
            f.invert();
        }
        if let Some(b) = &mut self.back {
            b.invert();
        }
        std::mem::swap(&mut self.front, &mut self.back);
    }

    fn clip_polygons(&self, polygons: Vec<Polygon>) -> Vec<Polygon> {
        let plane = match &self.plane {
            Some(p) => *p,
            None => return polygons,
        };
        let mut cf: Vec<Polygon> = Vec::new();
        let mut cb: Vec<Polygon> = Vec::new();
        let mut front: Vec<Polygon> = Vec::new();
        let mut back: Vec<Polygon> = Vec::new();
        for p in &polygons {
            plane.split_polygon(p, &mut cf, &mut cb, &mut front, &mut back);
        }
        // Coplanar-front joins the front set, coplanar-back the back set.
        front.extend(cf);
        back.extend(cb);
        if let Some(f) = &self.front {
            front = f.clip_polygons(front);
        }
        back = match &self.back {
            Some(b) => b.clip_polygons(back),
            None => Vec::new(),
        };
        front.extend(back);
        front
    }

    fn clip_to(&mut self, bsp: &Node) {
        self.polygons = bsp.clip_polygons(std::mem::take(&mut self.polygons));
        if let Some(f) = &mut self.front {
            f.clip_to(bsp);
        }
        if let Some(b) = &mut self.back {
            b.clip_to(bsp);
        }
    }

    fn all_polygons(&self) -> Vec<Polygon> {
        let mut out = self.polygons.clone();
        if let Some(f) = &self.front {
            out.extend(f.all_polygons());
        }
        if let Some(b) = &self.back {
            out.extend(b.all_polygons());
        }
        out
    }

    fn build(&mut self, polygons: Vec<Polygon>) {
        if polygons.is_empty() {
            return;
        }
        if self.plane.is_none() {
            self.plane = Some(polygons[0].plane);
        }
        let plane = self.plane.unwrap();
        let mut cf: Vec<Polygon> = Vec::new();
        let mut cb: Vec<Polygon> = Vec::new();
        let mut front: Vec<Polygon> = Vec::new();
        let mut back: Vec<Polygon> = Vec::new();
        for p in &polygons {
            plane.split_polygon(p, &mut cf, &mut cb, &mut front, &mut back);
        }
        // Both coplanar sets belong to this node's own polygon list.
        self.polygons.extend(cf);
        self.polygons.extend(cb);
        if !front.is_empty() {
            self.front
                .get_or_insert_with(|| Box::new(Node::default()))
                .build(front);
        }
        if !back.is_empty() {
            self.back
                .get_or_insert_with(|| Box::new(Node::default()))
                .build(back);
        }
    }
}

/// A solid, represented by its boundary polygons.
#[derive(Clone)]
pub struct Csg {
    pub polygons: Vec<Polygon>,
}

impl Csg {
    pub fn from_polygons(polygons: Vec<Polygon>) -> Csg {
        Csg { polygons }
    }

    pub fn union(&self, other: &Csg) -> Csg {
        let mut a = Node::from(self.polygons.clone());
        let mut b = Node::from(other.polygons.clone());
        a.clip_to(&b);
        b.clip_to(&a);
        b.invert();
        b.clip_to(&a);
        b.invert();
        a.build(b.all_polygons());
        Csg::from_polygons(a.all_polygons())
    }

    pub fn subtract(&self, other: &Csg) -> Csg {
        let mut a = Node::from(self.polygons.clone());
        let mut b = Node::from(other.polygons.clone());
        a.invert();
        a.clip_to(&b);
        b.clip_to(&a);
        b.invert();
        b.clip_to(&a);
        b.invert();
        a.build(b.all_polygons());
        a.invert();
        Csg::from_polygons(a.all_polygons())
    }

    pub fn intersect(&self, other: &Csg) -> Csg {
        let mut a = Node::from(self.polygons.clone());
        let mut b = Node::from(other.polygons.clone());
        a.invert();
        b.clip_to(&a);
        b.invert();
        a.clip_to(&b);
        b.clip_to(&a);
        a.build(b.all_polygons());
        a.invert();
        Csg::from_polygons(a.all_polygons())
    }
}

/// Fan-triangulate every polygon into flat-shaded (position, normal) buffers.
pub fn to_mesh(csg: &Csg) -> (Vec<f32>, Vec<f32>) {
    let mut positions: Vec<f32> = Vec::new();
    let mut normals: Vec<f32> = Vec::new();
    for poly in &csg.polygons {
        let vs = &poly.vertices;
        if vs.len() < 3 {
            continue;
        }
        let n = poly.plane.normal;
        for i in 2..vs.len() {
            for v in [vs[0], vs[i - 1], vs[i]] {
                positions.push(v.pos.x as f32);
                positions.push(v.pos.y as f32);
                positions.push(v.pos.z as f32);
                normals.push(n.x as f32);
                normals.push(n.y as f32);
                normals.push(n.z as f32);
            }
        }
    }
    (positions, normals)
}
