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
    this.declared.push({ kind: "number", name, min, max, step, value });
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
