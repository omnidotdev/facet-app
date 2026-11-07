import type {
  Completion,
  CompletionContext,
  CompletionResult,
  CompletionSource,
} from "@codemirror/autocomplete";

/**
 * Context-aware autocomplete for the Facet authoring API (see src/facet/api.ts).
 *
 * Two surfaces, chosen by what precedes the cursor:
 * - after a `.` (member access on a Shape, e.g. `base.`), the fluent Shape
 *   methods (`union`, `subtract`, `fillet`, ...)
 * - at the top level, the free functions (`cube`, `sphere`, `union`, ...) plus
 *   the `param` builder
 *
 * `param.` is a special member case: `param` is not a Shape, so after it the
 * members are `number`, `boolean`, `enum`, and `select`.
 */

/** Fluent methods on a Shape, offered after a `.` (member access). */
const SHAPE_METHODS: Completion[] = [
  {
    label: "union",
    type: "method",
    detail: ".union(...others)",
    info: "Fuse this shape with others",
  },
  {
    label: "add",
    type: "method",
    detail: ".add(...others)",
    info: "Alias for union",
  },
  {
    label: "subtract",
    type: "method",
    detail: ".subtract(...others)",
    info: "Cut others out of this shape",
  },
  {
    label: "sub",
    type: "method",
    detail: ".sub(...others)",
    info: "Alias for subtract",
  },
  {
    label: "intersect",
    type: "method",
    detail: ".intersect(...others)",
    info: "Keep only the overlap with others",
  },
  {
    label: "translate",
    type: "method",
    detail: ".translate(x, y?, z?)",
    info: "Move by (x, y, z), or by a vector",
  },
  {
    label: "move",
    type: "method",
    detail: ".move(x, y?, z?)",
    info: "Alias for translate",
  },
  {
    label: "rotate",
    type: "method",
    detail: ".rotate(x, y?, z?)",
    info: "Rotate in degrees about X, Y, Z (applied in that order)",
  },
  {
    label: "scale",
    type: "method",
    detail: ".scale(x, y?, z?)",
    info: "Scale; a single number scales uniformly",
  },
  {
    label: "mirror",
    type: "method",
    detail: ".mirror(x, y?, z?)",
    info: "Mirror across the plane whose normal is (x, y, z); mirror([1,0,0]) flips X",
  },
  {
    label: "fillet",
    type: "method",
    detail: ".fillet(radius)",
    info: "Round every edge by radius (B-rep kernel)",
  },
  {
    label: "chamfer",
    type: "method",
    detail: ".chamfer(size)",
    info: "Bevel every edge by size (B-rep kernel)",
  },
  {
    label: "shell",
    type: "method",
    detail: ".shell(thickness)",
    info: "Hollow to a wall of thickness, opening the top +Z face (B-rep kernel)",
  },
];

/** Free functions and builders available at the top level. */
const TOP_LEVEL: Completion[] = [
  {
    label: "cube",
    type: "function",
    detail: "cube(size, { center })",
    info: "A box; cube(10) is 10 on a side, cube([w,d,h]) is rectangular. Centered by default",
  },
  {
    label: "box",
    type: "function",
    detail: "box(size, { center })",
    info: "Alias for cube",
  },
  {
    label: "sphere",
    type: "function",
    detail: "sphere(r, { segments })",
    info: "A sphere of radius r",
  },
  {
    label: "cylinder",
    type: "function",
    detail: "cylinder(r, h, { center, segments })",
    info: "A cylinder of radius r and height h. Centered by default",
  },
  {
    label: "cone",
    type: "function",
    detail: "cone(r1, r2, h, { center, segments })",
    info: "A cone or taper; r2 = 0 is a sharp apex, r2 > 0 a truncated cone. Centered by default",
  },
  {
    label: "union",
    type: "function",
    detail: "union(...shapes)",
    info: "Fuse shapes together",
  },
  {
    label: "difference",
    type: "function",
    detail: "difference(base, ...cut)",
    info: "Cut shapes out of a base",
  },
  {
    label: "intersection",
    type: "function",
    detail: "intersection(...shapes)",
    info: "Keep only the overlap of shapes",
  },
  {
    label: "hull",
    type: "function",
    detail: "hull(...shapes)",
    info: "The convex hull wrapping all the shapes",
  },
  {
    label: "polyhedron",
    type: "function",
    detail: "polyhedron(points, faces)",
    info: "An explicit mesh from points and faces; wind each face counterclockwise seen from outside",
  },
  {
    label: "grid",
    type: "function",
    detail: "grid(shape, nx, ny, spacing)",
    info: "Tile a shape into a centered nx by ny grid (union of copies)",
  },
  {
    label: "rectTube",
    type: "function",
    detail: "rectTube([ox, oy], wall, h)",
    info: "A hollow rectangular tube/frame, centered",
  },
  {
    label: "circle",
    type: "function",
    detail: "circle(r, { segments })",
    info: "A 2D circle; a low segments count makes a regular polygon. Extrude or revolve it",
  },
  {
    label: "square",
    type: "function",
    detail: "square(size, { center })",
    info: "A 2D square/rectangle; square([w,h]) is rectangular. Centered by default",
  },
  {
    label: "rect",
    type: "function",
    detail: "rect(size, { center })",
    info: "Alias for square",
  },
  {
    label: "polygon",
    type: "function",
    detail: "polygon(points)",
    info: "A 2D polygon from [x,y] point pairs; the ring closes automatically",
  },
  {
    label: "importSvg",
    type: "function",
    detail: "importSvg(pathData)",
    info: "A 2D sketch from an SVG path string (an icon/glyph/logo); extrude or revolve it",
  },
  {
    label: "text",
    type: "function",
    detail: "text(content, { size })",
    info: "A line of text as a 2D sketch (size mm tall); extrude for a raised label or subtract for engraved",
  },
  {
    label: "extrude",
    type: "function",
    detail: "extrude(sketch, height, { twist, scale })",
    info: "Turn a 2D sketch into a solid by extruding it up. twist in degrees, scale tapers the top",
  },
  {
    label: "revolve",
    type: "function",
    detail: "revolve(sketch, { angle, segments })",
    info: "Turn a 2D sketch into a solid of revolution about the Z axis. angle in degrees (360 = full)",
  },
  {
    label: "param",
    type: "namespace",
    detail: "param.number(name, { min, max, default, step })",
    info: "Declare a live model parameter (drives a viewport slider)",
  },
];

/** Members of the `param` builder, offered after `param.`. */
const PARAM_MEMBERS: Completion[] = [
  {
    label: "number",
    type: "method",
    detail: "param.number(name, { min, max, default, step })",
    info: "Declare a numeric parameter and return its current value",
  },
  {
    label: "boolean",
    type: "method",
    detail: "param.boolean(name, { default })",
    info: "Declare a boolean parameter (renders a checkbox) and return its value",
  },
  {
    label: "enum",
    type: "method",
    detail: "param.enum(name, { options, default })",
    info: "Declare a choice parameter (renders a dropdown) and return the selected option",
  },
  {
    label: "select",
    type: "method",
    detail: "param.select(name, { options, default })",
    info: "Alias for param.enum",
  },
];

/**
 * Facet-API completion source. Opens on Ctrl+Space (Mod-Space) and while typing
 * an identifier or a member access. Member completions depend on the receiver:
 * `param.` offers the param builder, any other `.` offers the Shape methods.
 */
export const facetApiCompletions: CompletionSource = (
  context: CompletionContext,
): CompletionResult | null => {
  // Member access: text immediately before the cursor is `.<word>`, with the
  // receiver identifier (if any) captured just before the dot
  const member = context.matchBefore(/(\w*)\.\w*/);
  if (member?.text.includes(".")) {
    const receiver = member.text.slice(0, member.text.indexOf("."));
    const options = receiver === "param" ? PARAM_MEMBERS : SHAPE_METHODS;
    return {
      from: member.from + member.text.indexOf(".") + 1,
      options,
      validFor: /^\w*$/,
    };
  }

  // Top level: a bare identifier. Do not pop open on an empty prefix unless the
  // user explicitly asked (Ctrl+Space)
  const word = context.matchBefore(/\w*/);
  if (!word || (word.from === word.to && !context.explicit)) return null;
  return {
    from: word.from,
    options: TOP_LEVEL,
    validFor: /^\w*$/,
  };
};
