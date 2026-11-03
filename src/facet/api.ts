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

  /**
   * Round every edge of this solid by `radius`. Exact geometry, so it needs the
   * B-rep kernel.
   */
  fillet(radius: number): Shape {
    return this.wrap({ op: "fillet", radius, child: this.node });
  }

  /**
   * Bevel every edge of this solid by `size`. Exact geometry, so it needs the
   * B-rep kernel.
   */
  chamfer(size: number): Shape {
    return this.wrap({ op: "chamfer", size, child: this.node });
  }

  /**
   * Hollow this solid to a wall of `thickness`, opening its topmost +Z face.
   * Exact geometry, so it needs the B-rep kernel.
   */
  shell(thickness: number): Shape {
    return this.wrap({ op: "shell", thickness, child: this.node });
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

/**
 * Tile a shape into an `nx` by `ny` grid on the XY plane, each copy spaced by
 * `spacing` (a single number for equal x/y, or `[sx, sy]`). The grid is centered
 * on the origin. Returns their union. Useful for tessellations and baseplates
 */
export function grid(
  shape: Shape,
  nx: number,
  ny: number,
  spacing: number | [number, number],
): Shape {
  const [sx, sy] = typeof spacing === "number" ? [spacing, spacing] : spacing;
  const cols = Math.max(1, Math.floor(nx));
  const rows = Math.max(1, Math.floor(ny));
  // Center the whole grid on the origin
  const ox = ((cols - 1) * sx) / 2;
  const oy = ((rows - 1) * sy) / 2;
  const copies: Shape[] = [];
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      copies.push(shape.translate(i * sx - ox, j * sy - oy, 0));
    }
  }
  return union(...copies);
}

/**
 * A hollow rectangular tube/frame: an `[ox, oy]` outer footprint with
 * `wall`-thick walls, `h` tall, centered. When the walls meet (wall too large
 * for the footprint) it degrades to a solid block rather than inverting
 */
export function rectTube(
  outer: [number, number],
  wall: number,
  h: number,
): Shape {
  const [ox, oy] = outer;
  const base = cube([ox, oy, h]);
  const iw = ox - 2 * wall;
  const id = oy - 2 * wall;
  if (iw <= 0 || id <= 0) return base;
  // Inner cut is slightly taller so it punches cleanly through top and bottom
  return base.subtract(cube([iw, id, h + 2]));
}
