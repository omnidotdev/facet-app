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

  /**
   * Mirror across the plane through the origin whose normal is (x, y, z), like
   * OpenSCAD's mirror. `mirror([1, 0, 0])` flips X, `[0, 1, 0]` flips Y.
   */
  mirror(x: number | Vec3, y?: number, z?: number): Shape {
    return this.wrap({
      op: "mirror",
      normal: asVec3(x, y, z),
      child: this.node,
    });
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

/**
 * A 2D sketch: a flat profile on the XY plane. Build one from `circle`,
 * `square`, or `polygon`, combine sketches with 2D booleans, then turn it into
 * a solid with `extrude` or `revolve`. Sketches only exist in the B-rep kernel,
 * so any model that uses them runs there.
 */
export class Sketch {
  constructor(readonly node: OpNode) {}

  private wrap(node: OpNode): Sketch {
    return new Sketch(node);
  }

  /** Grow (positive) or shrink (negative) this outline by `distance`. */
  offset(distance: number): Sketch {
    return this.wrap({ op: "offset2d", distance, child: this.node });
  }

  /** Fuse this sketch with others (2D union). */
  union(...others: Sketch[]): Sketch {
    return this.wrap({
      op: "union2d",
      children: [this.node, ...others.map((s) => s.node)],
    });
  }
  add(...others: Sketch[]): Sketch {
    return this.union(...others);
  }

  /** Cut others out of this sketch (2D difference). */
  subtract(...others: Sketch[]): Sketch {
    return this.wrap({
      op: "difference2d",
      children: [this.node, ...others.map((s) => s.node)],
    });
  }
  sub(...others: Sketch[]): Sketch {
    return this.subtract(...others);
  }

  /** Keep only the overlap of this sketch with others (2D intersection). */
  intersect(...others: Sketch[]): Sketch {
    return this.wrap({
      op: "intersect2d",
      children: [this.node, ...others.map((s) => s.node)],
    });
  }

  /**
   * Extrude this sketch straight up by `height` into a solid. `twist` turns the
   * profile that many degrees over the height; `scale` tapers the top face
   * (1 = straight walls, 0.5 = half-size top).
   */
  extrude(
    height: number,
    opts: { twist?: number; scale?: number } = {},
  ): Shape {
    return new Shape({
      op: "extrude",
      height,
      twist: opts.twist ?? 0,
      scale: opts.scale ?? 1,
      child: this.node,
    });
  }

  /**
   * Revolve this sketch about the Z axis into a solid of revolution. The
   * profile's X is the radius and its Y the height. `angle` is the sweep in
   * degrees (360 = a full solid).
   */
  revolve(opts: { angle?: number; segments?: number } = {}): Shape {
    return new Shape({
      op: "revolve",
      angle: opts.angle ?? 360,
      segments: opts.segments ?? 64,
      child: this.node,
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

/**
 * A cone or taper: bottom radius `r1`, top radius `r2`, height `h`. `r2 = 0`
 * (the default) is a sharp apex; a positive `r2` makes a truncated cone
 * (OpenSCAD's cylinder(r1, r2, h)). Centered on the origin by default.
 */
export function cone(
  r1 = 1,
  r2 = 0,
  h = 1,
  opts: { center?: boolean; segments?: number } = {},
): Shape {
  return new Shape({
    op: "cone",
    r1,
    r2,
    h,
    segments: opts.segments ?? 32,
    center: opts.center ?? true,
  });
}

// --- 2D sketches ------------------------------------------------------------

/** A 2D circle of radius `r`. A low `segments` count makes a regular polygon. */
export function circle(r = 1, opts: { segments?: number } = {}): Sketch {
  return new Sketch({ op: "circle2d", r, segments: opts.segments ?? 64 });
}

/**
 * A 2D square/rectangle. `square(10)` is 10 on a side; `square([w, h])` is
 * rectangular. Centered on the origin by default.
 */
export function square(
  size: number | [number, number] = 1,
  opts: { center?: boolean } = {},
): Sketch {
  const s: [number, number] = Array.isArray(size) ? size : [size, size];
  return new Sketch({ op: "rect2d", size: s, center: opts.center ?? true });
}
/** Alias for square. */
export const rect = square;

/**
 * A 2D polygon from a ring of points, given as `[x, y]` pairs (or a flat
 * `[x0, y0, x1, y1, ...]` list). The ring closes back to the first point.
 */
export function polygon(points: [number, number][] | number[]): Sketch {
  const flat =
    points.length > 0 && Array.isArray(points[0])
      ? (points as [number, number][]).flat()
      : (points as number[]);
  return new Sketch({ op: "polygon2d", points: flat });
}

/**
 * A 2D sketch from an SVG path `d` string (an icon, a glyph, a logo outline).
 * The Y axis is flipped so the art reads upright, and opposite-wound subpaths
 * become holes. Extrude or revolve the result like any other sketch.
 */
export function importSvg(path: string): Sketch {
  return new Sketch({ op: "svg2d", path });
}

/**
 * A line of text as a 2D sketch, in the bundled sans font, `size` mm tall.
 * Extrude it for a raised or (subtract it for) an engraved label.
 */
export function text(content: string, opts: { size?: number } = {}): Sketch {
  return new Sketch({ op: "text2d", text: content, size: opts.size ?? 10 });
}

/** Extrude a 2D sketch straight up by `height` into a solid. */
export function extrude(
  sketch: Sketch,
  height: number,
  opts: { twist?: number; scale?: number } = {},
): Shape {
  return sketch.extrude(height, opts);
}

/** Revolve a 2D sketch about the Z axis into a solid of revolution. */
export function revolve(
  sketch: Sketch,
  opts: { angle?: number; segments?: number } = {},
): Shape {
  return sketch.revolve(opts);
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
 * The convex hull of every shape (OpenSCAD's hull()): the tightest convex solid
 * that contains them all. Great for lofting between profiles or rounding a set
 * of points into one smooth body.
 */
export function hull(...shapes: Shape[]): Shape {
  if (!shapes.length) throw new Error("hull needs at least one shape");
  return new Shape({ op: "hull", children: shapes.map((s) => s.node) });
}

/**
 * An explicit mesh (OpenSCAD's polyhedron) from a list of `points` and the
 * `faces` that connect them, each face a list of point indices. Order each
 * face's vertices so they run in a consistent rotational order seen from
 * OUTSIDE the solid, so its normal points outward. A face may have any number
 * of vertices (>= 3); non-triangular faces are fan-triangulated.
 *
 * The fan triangulation assumes each face is CONVEX (as OpenSCAD's polyhedron
 * does): a concave face must be pre-split into convex faces, or its fan will
 * cross outside the outline. A concave planar face can also tessellate
 * differently between the mesh and exact (B-rep) kernels, since the mesh kernel
 * fans it while the B-rep kernel sews it as one planar n-gon face.
 */
export function polyhedron(points: Vec3[], faces: number[][]): Shape {
  const flatPoints = points.flat();
  const flatFaces = faces.flatMap((f) => [f.length, ...f]);
  return new Shape({ op: "polyhedron", points: flatPoints, faces: flatFaces });
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
