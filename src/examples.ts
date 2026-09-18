/** Starter models. Each is plain JS the editor runs against the Facet API. */
export const examples: Record<string, string> = {
  "Parametric plate": `// Drag the sliders (top-left of the viewport) - the model is live
const w = param.number("width", { min: 20, max: 90, default: 50, step: 1 });
const d = param.number("depth", { min: 20, max: 90, default: 34, step: 1 });
const h = param.number("height", { min: 4, max: 40, default: 12, step: 1 });
const r = param.number("hole", { min: 0, max: 14, default: 6, step: 0.5 });

let plate = cube([w, d, h]);
if (r > 0) {
  plate = plate.subtract(cylinder(r, h + 2, { segments: 48 }));
}
return plate;`,

  "L-bracket": `// L-bracket with two bolt holes
const t = 5;   // thickness
const w = 40;  // width

const base = cube([w, 40, t], { center: false });
const wall = cube([w, t, 30], { center: false });
let part = base.union(wall);

// drill two holes through the base
const hole = cylinder(3.2, t * 4, { segments: 32 });
part = part.subtract(
  hole.translate(12, 20, t / 2),
  hole.translate(28, 20, t / 2),
);

return part;`,

  "Bolt flange": `// Pipe flange with a ring of bolt holes
const flange = cylinder(30, 6, { segments: 72 });
const bore = cylinder(14, 20, { segments: 72 });
let part = flange.subtract(bore);

const bolts = 6;
for (let i = 0; i < bolts; i++) {
  const a = (i / bolts) * Math.PI * 2;
  const hole = cylinder(3, 20, { segments: 24 })
    .translate(Math.cos(a) * 22, Math.sin(a) * 22, 0);
  part = part.subtract(hole);
}

return part;`,

  "Faceted gem": `// A cut gem - a coarse sphere clipped flat to a table facet
const stone = sphere(20, { segments: 10 });
const table = cube([60, 60, 40], { center: true }).translate(0, 0, 32);
return stone.subtract(table).scale(1, 1, 1.25);`,

  "LEGO brick": `// A 2x4 LEGO-style brick: hollow body, studs on top, tubes underneath
const P = 8;               // stud pitch
const cols = 4, rows = 2;
const W = cols * P, D = rows * P, H = 9.6;
const wall = 1.5;
const studR = 2.4, studH = 1.8;

// hollow body: top stays closed, bottom is open
const outer = cube([W, D, H], { center: false });
const inner = cube([W - 2 * wall, D - 2 * wall, H - wall], { center: false })
  .translate(wall, wall, -0.01);
let brick = outer.subtract(inner);

// studs on top
for (let cx = 0; cx < cols; cx++) {
  for (let cy = 0; cy < rows; cy++) {
    const stud = cylinder(studR, studH, { center: false, segments: 24 })
      .translate((cx + 0.5) * P, (cy + 0.5) * P, H);
    brick = brick.union(stud);
  }
}

// underside tubes between the studs
for (let i = 1; i < cols; i++) {
  const tube = cylinder(3.25, H - wall, { center: false, segments: 24 })
    .subtract(cylinder(2.4, H - wall + 0.1, { center: false, segments: 24 }))
    .translate(i * P, D / 2, 0);
  brick = brick.union(tube);
}

return brick;`,

  "Dice (d6)": `// A d6 with pips drilled on all six faces (opposite faces sum to 7)
let die = cube(20);
const s = 10;    // half-size (face distance)
const d = 4.6;   // pip spacing
const r = 2.0;   // pip radius

// one pip, placed by which face ('x'|'y'|'z'), its sign, and in-face (u, v)
const pip = (face, sign, u, v) => {
  const p = face === "x" ? [sign * s, u, v]
          : face === "y" ? [u, sign * s, v]
          :                [u, v, sign * s];
  return sphere(r, { segments: 16 }).translate(p[0], p[1], p[2]);
};

const layouts = {
  1: [[0, 0]],
  2: [[-d, -d], [d, d]],
  3: [[-d, -d], [0, 0], [d, d]],
  4: [[-d, -d], [-d, d], [d, -d], [d, d]],
  5: [[-d, -d], [-d, d], [0, 0], [d, -d], [d, d]],
  6: [[-d, -d], [-d, 0], [-d, d], [d, -d], [d, 0], [d, d]],
};

// value per face, arranged so opposite faces sum to 7
const faces = [
  ["z", 1, 1], ["z", -1, 6],
  ["x", 1, 2], ["x", -1, 5],
  ["y", 1, 3], ["y", -1, 4],
];

for (const [face, sign, value] of faces) {
  for (const [u, v] of layouts[value]) {
    die = die.subtract(pip(face, sign, u, v));
  }
}

return die;`,
};

export const defaultExample = "Parametric plate";
