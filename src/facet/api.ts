import type { OpNode, Vec3 } from "./opgraph";

/**
 * The Facet authoring API. This is what people write against.
 *
 * Calling these builds an op-graph; it does not compute geometry. A Shape is
 * an immutable handle onto one op-graph node, with a fluent, chainable surface
 * modeled after how you actually think about a part: make a primitive, move it,
 * cut things out of it.
 */

function asVec3(x: number | Vec3, y?: number, z?: number): Vec3 {
  if (Array.isArray(x)) return x;
  return [x, y ?? 0, z ?? 0];
}

export class Shape {
  constructor(readonly node: OpNode) {}

  private wrap(node: OpNode): Shape {
    return new Shape(node);
  }

  /** Move by (x, y, z), or by a vector. */
  translate(x: number | Vec3, y?: number, z?: number): Shape {
    return this.wrap({ op: "translate", v: asVec3(x, y, z), child: this.node });
  }
  /** Alias for translate. */
  move(x: number | Vec3, y?: number, z?: number): Shape {
    return this.translate(x, y, z);
  }

  /** Rotate in degrees about X, Y, Z (applied in that order). */
  rotate(x: number | Vec3, y?: number, z?: number): Shape {
    return this.wrap({ op: "rotate", deg: asVec3(x, y, z), child: this.node });
  }

  /** Scale. A single number scales uniformly. */
  scale(x: number | Vec3, y?: number, z?: number): Shape {
    const v: Vec3 = Array.isArray(x) ? x : [x, y ?? x, z ?? x];
    return this.wrap({ op: "scale", v, child: this.node });
  }

  /** Fuse this shape with others. */
  union(...others: Shape[]): Shape {
    return this.wrap({
      op: "union",
      children: [this.node, ...others.map((s) => s.node)],
    });
  }
  add(...others: Shape[]): Shape {
    return this.union(...others);
  }

  /** Cut others out of this shape. */
  subtract(...others: Shape[]): Shape {
    return this.wrap({
      op: "difference",
      children: [this.node, ...others.map((s) => s.node)],
    });
  }
  sub(...others: Shape[]): Shape {
    return this.subtract(...others);
  }

  /** Keep only the overlap with others. */
  intersect(...others: Shape[]): Shape {
    return this.wrap({
      op: "intersect",
      children: [this.node, ...others.map((s) => s.node)],
    });
  }
}

// --- Primitives -------------------------------------------------------------

/** A box. `cube(10)` is 10 on a side; `cube([w,d,h])` is rectangular. Centered by default. */
export function cube(
  size: number | Vec3 = 1,
  opts: { center?: boolean } = {},
): Shape {
  const s: Vec3 = Array.isArray(size) ? size : [size, size, size];
  return new Shape({ op: "cube", size: s, center: opts.center ?? true });
}
/** Alias for cube. */
export const box = cube;

export function sphere(r = 1, opts: { segments?: number } = {}): Shape {
  return new Shape({ op: "sphere", r, segments: opts.segments ?? 32 });
}

export function cylinder(
  r = 1,
  h = 1,
  opts: { center?: boolean; segments?: number } = {},
): Shape {
  return new Shape({
    op: "cylinder",
    r,
    h,
    segments: opts.segments ?? 32,
    center: opts.center ?? true,
  });
}

// --- Free-function booleans (read nicely at the top level) ------------------

export function union(...shapes: Shape[]): Shape {
  if (!shapes.length) throw new Error("union needs at least one shape");
  const [first, ...rest] = shapes;
  return first.union(...rest);
}

export function difference(base: Shape, ...cut: Shape[]): Shape {
  return base.subtract(...cut);
}

export function intersection(...shapes: Shape[]): Shape {
  if (!shapes.length) throw new Error("intersection needs at least one shape");
  const [first, ...rest] = shapes;
  return first.intersect(...rest);
}
