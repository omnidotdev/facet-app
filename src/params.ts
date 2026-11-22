/**
 * Live model parameters. A model calls `param.number(...)`, `param.boolean(...)`,
 * or `param.enum(...)` while it runs; each call registers the parameter and
 * returns its current value. The app reads the registry after a run to build
 * controls (slider / checkbox / dropdown), and writes back when one is changed.
 */

interface NumberOpts {
  min?: number;
  max?: number;
  step?: number;
  default?: number;
  /** Display unit shown beside the slider value, e.g. "mm" or "°" */
  unit?: string;
}

interface BooleanOpts {
  default?: boolean;
}

interface EnumOpts {
  options: string[];
  default?: string;
}

/** A declared parameter, discriminated by control kind. */
type ParamDecl =
  | {
      kind: "number";
      name: string;
      min: number;
      max: number;
      step: number;
      value: number;
      unit?: string;
    }
  | { kind: "boolean"; name: string; value: boolean }
  | { kind: "enum"; name: string; options: string[]; value: string };

/** A stored parameter value, by kind. */
type ParamValue = number | boolean | string;

interface ParamApi {
  number(name: string, opts?: NumberOpts): number;
  boolean(name: string, opts?: BooleanOpts): boolean;
  enum(name: string, opts: EnumOpts): string;
  /** Alias for `enum`. */
  select(name: string, opts: EnumOpts): string;
}

/** Longest unit label kept, so model code cannot stretch the panel */
const MAX_UNIT_LENGTH = 8;

/** Trim a model-supplied unit label, dropping empty or non-string values */
const normalizeUnit = (unit: unknown): string | undefined => {
  if (typeof unit !== "string") return undefined;
  const trimmed = unit.trim().slice(0, MAX_UNIT_LENGTH);
  return trimmed || undefined;
};

/**
 * Evaluate a typed arithmetic expression: numbers with + - * / and
 * parentheses, so a value can be entered as "50/2" or "12 + 3.5". Returns
 * null for anything else; nothing is ever passed to eval
 */
export const evaluateArithmetic = (text: string): number | null => {
  const src = text;
  let i = 0;
  // Whitespace separates tokens but never joins them, so "4 4" is not 44
  const peek = () => {
    while (src[i] === " " || src[i] === "\t") i++;
    return src[i];
  };

  // expr := term (('+' | '-') term)*
  const expr = (): number | null => {
    let left = term();
    while (left !== null && (peek() === "+" || peek() === "-")) {
      const op = src[i++];
      const right = term();
      if (right === null) return null;
      left = op === "+" ? left + right : left - right;
    }
    return left;
  };
  // term := factor (('*' | '/') factor)*
  const term = (): number | null => {
    let left = factor();
    while (left !== null && (peek() === "*" || peek() === "/")) {
      const op = src[i++];
      const right = factor();
      if (right === null) return null;
      left = op === "*" ? left * right : left / right;
    }
    return left;
  };
  // factor := ('-' | '+') factor | '(' expr ')' | number
  const factor = (): number | null => {
    if (peek() === "-" || peek() === "+") {
      const sign = src[i++] === "-" ? -1 : 1;
      const v = factor();
      return v === null ? null : sign * v;
    }
    if (peek() === "(") {
      i++;
      const v = expr();
      if (v === null || peek() !== ")") return null;
      i++;
      return v;
    }
    peek();
    const match = /^(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/i.exec(src.slice(i));
    if (!match) return null;
    i += match[0].length;
    return Number(match[0]);
  };

  const value = expr();
  peek();
  return value !== null && i === src.length && Number.isFinite(value)
    ? value
    : null;
};

/** The outcome of typing a value for a number parameter */
export type TypedParamValue =
  | { ok: true; value: number; clamped: boolean }
  | { ok: false };

/**
 * Read a typed value for a number parameter: an exact number or simple
 * arithmetic, optionally followed by the parameter's own unit ("25 mm"),
 * clamped to the declared range so a model never sees a value its author
 * ruled out. It is not snapped to the slider step, so exact values survive
 */
export const parseParamInput = (
  text: string,
  { min, max, unit }: { min: number; max: number; unit?: string },
): TypedParamValue => {
  let body = text.trim();
  if (unit) {
    const lower = body.toLowerCase();
    const suffix = unit.toLowerCase();
    if (lower.endsWith(suffix)) body = body.slice(0, -suffix.length);
  }
  const value = evaluateArithmetic(body);
  if (value === null) return { ok: false };
  const clampedValue = Math.min(Math.max(value, min), max);
  return { ok: true, value: clampedValue, clamped: clampedValue !== value };
};

/**
 * A number as typed back into a value field: rounded off at float noise
 * (0.1 + 0.2 reads as 0.3) but otherwise exact
 */
export const formatParamNumber = (value: number): string =>
  String(Number(value.toPrecision(10)));

export class ParamStore {
  private values = new Map<string, ParamValue>();
  private declared: ParamDecl[] = [];

  /** Clear the per-run declaration list (values persist across runs). */
  begin(): void {
    this.declared = [];
  }

  /**
   * Forget all stored values so the next run re-seeds each parameter from its
   * declared default. Used when a different example loads, so one example's
   * tuned values do not carry over to another by shared name
   */
  reset(): void {
    this.values.clear();
  }

  number(name: string, opts: NumberOpts = {}): number {
    const def = opts.default ?? opts.min ?? 0;
    const stored = this.values.get(name);
    const value = typeof stored === "number" ? stored : def;
    this.values.set(name, value);

    const min = opts.min ?? 0;
    const max = opts.max ?? Math.max(min + 1, def * 2 || min + 10);
    const step = opts.step ?? ((max - min) / 100 || 0.1);
    const unit = normalizeUnit(opts.unit);
    this.declared.push({
      kind: "number",
      name,
      min,
      max,
      step,
      value,
      ...(unit ? { unit } : {}),
    });
    return value;
  }

  boolean(name: string, opts: BooleanOpts = {}): boolean {
    const def = opts.default ?? false;
    const stored = this.values.get(name);
    const value = typeof stored === "boolean" ? stored : def;
    this.values.set(name, value);
    this.declared.push({ kind: "boolean", name, value });
    return value;
  }

  enum(name: string, opts: EnumOpts): string {
    const options = opts.options ?? [];
    const fallback =
      opts.default !== undefined && options.includes(opts.default)
        ? opts.default
        : (options[0] ?? "");
    // Keep a stored value only while it is still a valid option
    const stored = this.values.get(name);
    const value =
      typeof stored === "string" && options.includes(stored)
        ? stored
        : fallback;
    this.values.set(name, value);
    this.declared.push({ kind: "enum", name, options, value });
    return value;
  }

  /** Alias for {@link enum}, for readers who prefer `param.select`. */
  select(name: string, opts: EnumOpts): string {
    return this.enum(name, opts);
  }

  /** The API object injected into model code as `param`. */
  api(): ParamApi {
    return {
      number: (name, opts) => this.number(name, opts),
      boolean: (name, opts) => this.boolean(name, opts),
      enum: (name, opts) => this.enum(name, opts),
      select: (name, opts) => this.select(name, opts),
    };
  }

  set(name: string, value: ParamValue): void {
    this.values.set(name, value);
  }

  /** Seed stored values (used in the sandbox worker from the main thread's snapshot). */
  seed(values: Record<string, ParamValue>): void {
    this.values = new Map(Object.entries(values));
  }

  /** Plain snapshot of stored values, to hand to the sandbox worker. */
  valuesSnapshot(): Record<string, ParamValue> {
    return Object.fromEntries(this.values);
  }

  /**
   * Adopt the declarations a worker run produced: the main thread no longer runs
   * the model itself, so it takes the worker's resolved declarations and values
   * (new parameters arrive at their default, tuned ones keep the value that was
   * sent in and echoed back) to drive the parameter UI.
   */
  adoptRun(decls: ParamDecl[]): void {
    this.declared = decls;
    for (const d of decls) this.values.set(d.name, d.value);
  }

  list(): ParamDecl[] {
    return this.declared;
  }

  /** Identity of the current control set, so the UI only rebuilds when it changes. */
  signature(): string {
    return this.declared
      .map((d) => {
        if (d.kind === "number") {
          return `n:${d.name}:${d.min}:${d.max}:${d.step}`;
        }
        if (d.kind === "boolean") {
          return `b:${d.name}`;
        }
        return `e:${d.name}:${d.options.join(",")}`;
      })
      .join("|");
  }
}

export type {
  ParamDecl,
  ParamValue,
  ParamApi,
  NumberOpts,
  BooleanOpts,
  EnumOpts,
};
