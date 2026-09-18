/**
 * Constructive Solid Geometry via BSP trees.
 *
 * A TypeScript port of Evan Wallace's csg.js (MIT). This is the P1 boolean
 * engine: robust enough for demos and printable parts, mesh-based (not exact
 * B-rep). It lives behind the Kernel interface so the P2 Rust kernel can
 * replace it wholesale.
 */

export class Vector {
  constructor(
    public x: number,
    public y: number,
    public z: number,
  ) {}
  clone(): Vector {
    return new Vector(this.x, this.y, this.z);
  }
  negated(): Vector {
    return new Vector(-this.x, -this.y, -this.z);
  }
  plus(a: Vector): Vector {
    return new Vector(this.x + a.x, this.y + a.y, this.z + a.z);
  }
  minus(a: Vector): Vector {
    return new Vector(this.x - a.x, this.y - a.y, this.z - a.z);
  }
  times(a: number): Vector {
    return new Vector(this.x * a, this.y * a, this.z * a);
  }
  dividedBy(a: number): Vector {
    return new Vector(this.x / a, this.y / a, this.z / a);
  }
  dot(a: Vector): number {
    return this.x * a.x + this.y * a.y + this.z * a.z;
  }
  lerp(a: Vector, t: number): Vector {
    return this.plus(a.minus(this).times(t));
  }
  length(): number {
    return Math.sqrt(this.dot(this));
  }
  unit(): Vector {
    return this.dividedBy(this.length());
  }
  cross(a: Vector): Vector {
    return new Vector(
      this.y * a.z - this.z * a.y,
      this.z * a.x - this.x * a.z,
      this.x * a.y - this.y * a.x,
    );
  }
}

export class Vertex {
  constructor(
    public pos: Vector,
    public normal: Vector,
  ) {}
  clone(): Vertex {
    return new Vertex(this.pos.clone(), this.normal.clone());
  }
  flip(): void {
    this.normal = this.normal.negated();
  }
  interpolate(other: Vertex, t: number): Vertex {
    return new Vertex(this.pos.lerp(other.pos, t), this.normal.lerp(other.normal, t));
  }
}

const enum Loc {
  COPLANAR = 0,
  FRONT = 1,
  BACK = 2,
  SPANNING = 3,
}

export class Plane {
  static EPSILON = 1e-5;
  constructor(
    public normal: Vector,
    public w: number,
  ) {}
  static fromPoints(a: Vector, b: Vector, c: Vector): Plane {
    const n = b.minus(a).cross(c.minus(a)).unit();
    return new Plane(n, n.dot(a));
  }
  clone(): Plane {
    return new Plane(this.normal.clone(), this.w);
  }
  flip(): void {
    this.normal = this.normal.negated();
    this.w = -this.w;
  }
  splitPolygon(
    polygon: Polygon,
    coplanarFront: Polygon[],
    coplanarBack: Polygon[],
    front: Polygon[],
    back: Polygon[],
  ): void {
    let polygonType = 0;
    const types: Loc[] = [];
    for (const v of polygon.vertices) {
      const t = this.normal.dot(v.pos) - this.w;
      const type = t < -Plane.EPSILON ? Loc.BACK : t > Plane.EPSILON ? Loc.FRONT : Loc.COPLANAR;
      polygonType |= type;
      types.push(type);
    }

    switch (polygonType) {
      case Loc.COPLANAR:
        (this.normal.dot(polygon.plane.normal) > 0 ? coplanarFront : coplanarBack).push(polygon);
        break;
      case Loc.FRONT:
        front.push(polygon);
        break;
      case Loc.BACK:
        back.push(polygon);
        break;
      case Loc.SPANNING: {
        const f: Vertex[] = [];
        const b: Vertex[] = [];
        for (let i = 0; i < polygon.vertices.length; i++) {
          const j = (i + 1) % polygon.vertices.length;
          const ti = types[i];
          const tj = types[j];
          const vi = polygon.vertices[i];
          const vj = polygon.vertices[j];
          if (ti !== Loc.BACK) f.push(vi);
          if (ti !== Loc.FRONT) b.push(ti !== Loc.BACK ? vi.clone() : vi);
          if ((ti | tj) === Loc.SPANNING) {
            const t = (this.w - this.normal.dot(vi.pos)) / this.normal.dot(vj.pos.minus(vi.pos));
            const v = vi.interpolate(vj, t);
            f.push(v);
            b.push(v.clone());
          }
        }
        if (f.length >= 3) front.push(new Polygon(f, polygon.shared));
        if (b.length >= 3) back.push(new Polygon(b, polygon.shared));
        break;
      }
    }
  }
}

export class Polygon {
  plane: Plane;
  constructor(
    public vertices: Vertex[],
    public shared?: unknown,
  ) {
    this.plane = Plane.fromPoints(vertices[0].pos, vertices[1].pos, vertices[2].pos);
  }
  clone(): Polygon {
    return new Polygon(
      this.vertices.map((v) => v.clone()),
      this.shared,
    );
  }
  flip(): void {
    this.vertices.reverse().forEach((v) => v.flip());
    this.plane.flip();
  }
}

/** A node in a BSP tree that recursively partitions space by polygon planes. */
class Node {
  plane: Plane | null = null;
  front: Node | null = null;
  back: Node | null = null;
  polygons: Polygon[] = [];

  constructor(polygons?: Polygon[]) {
    if (polygons) this.build(polygons);
  }
  clone(): Node {
    const node = new Node();
    node.plane = this.plane?.clone() ?? null;
    node.front = this.front?.clone() ?? null;
    node.back = this.back?.clone() ?? null;
    node.polygons = this.polygons.map((p) => p.clone());
    return node;
  }
  /** Flip solid space to empty and vice versa (converts union to intersection). */
  invert(): void {
    for (const p of this.polygons) p.flip();
    this.plane?.flip();
    this.front?.invert();
    this.back?.invert();
    const temp = this.front;
    this.front = this.back;
    this.back = temp;
  }
  /** Remove all parts of `polygons` that are inside this BSP tree. */
  clipPolygons(polygons: Polygon[]): Polygon[] {
    if (!this.plane) return polygons.slice();
    let front: Polygon[] = [];
    let back: Polygon[] = [];
    for (const p of polygons) {
      this.plane.splitPolygon(p, front, back, front, back);
    }
    if (this.front) front = this.front.clipPolygons(front);
    back = this.back ? this.back.clipPolygons(back) : [];
    return front.concat(back);
  }
  /** Remove all polygons in this tree that are inside the other BSP tree. */
  clipTo(bsp: Node): void {
    this.polygons = bsp.clipPolygons(this.polygons);
    this.front?.clipTo(bsp);
    this.back?.clipTo(bsp);
  }
  allPolygons(): Polygon[] {
    let polygons = this.polygons.slice();
    if (this.front) polygons = polygons.concat(this.front.allPolygons());
    if (this.back) polygons = polygons.concat(this.back.allPolygons());
    return polygons;
  }
  build(polygons: Polygon[]): void {
    if (!polygons.length) return;
    if (!this.plane) this.plane = polygons[0].plane.clone();
    const front: Polygon[] = [];
    const back: Polygon[] = [];
    for (const p of polygons) {
      this.plane.splitPolygon(p, this.polygons, this.polygons, front, back);
    }
    if (front.length) {
      if (!this.front) this.front = new Node();
      this.front.build(front);
    }
    if (back.length) {
      if (!this.back) this.back = new Node();
      this.back.build(back);
    }
  }
}

/** An immutable solid, represented as a set of boundary polygons. */
export class CSG {
  polygons: Polygon[] = [];

  static fromPolygons(polygons: Polygon[]): CSG {
    const csg = new CSG();
    csg.polygons = polygons;
    return csg;
  }
  clone(): CSG {
    return CSG.fromPolygons(this.polygons.map((p) => p.clone()));
  }
  toPolygons(): Polygon[] {
    return this.polygons;
  }

  union(other: CSG): CSG {
    const a = new Node(this.clone().polygons);
    const b = new Node(other.clone().polygons);
    a.clipTo(b);
    b.clipTo(a);
    b.invert();
    b.clipTo(a);
    b.invert();
    a.build(b.allPolygons());
    return CSG.fromPolygons(a.allPolygons());
  }
  subtract(other: CSG): CSG {
    const a = new Node(this.clone().polygons);
    const b = new Node(other.clone().polygons);
    a.invert();
    a.clipTo(b);
    b.clipTo(a);
    b.invert();
    b.clipTo(a);
    b.invert();
    a.build(b.allPolygons());
    a.invert();
    return CSG.fromPolygons(a.allPolygons());
  }
  intersect(other: CSG): CSG {
    const a = new Node(this.clone().polygons);
    const b = new Node(other.clone().polygons);
    a.invert();
    b.clipTo(a);
    b.invert();
    a.clipTo(b);
    b.clipTo(a);
    a.build(b.allPolygons());
    a.invert();
    return CSG.fromPolygons(a.allPolygons());
  }
}
