/**
 * Live model parameters. A model calls `param.number(...)` while it runs; each
 * call registers the parameter and returns its current value. The app reads the
 * registry after a run to build sliders, and writes back when one is dragged.
 */

interface NumberOpts {
  min?: number;
  max?: number;
  step?: number;
  default?: number;
}

interface ParamDecl {
  name: string;
  min: number;
  max: number;
  step: number;
  value: number;
}

interface ParamApi {
  number(name: string, opts?: NumberOpts): number;
}

export class ParamStore {
  private values = new Map<string, number>();
  private declared: ParamDecl[] = [];

  /** Clear the per-run declaration list (values persist across runs). */
  begin(): void {
    this.declared = [];
  }

  number(name: string, opts: NumberOpts = {}): number {
    const def = opts.default ?? opts.min ?? 0;
    const stored = this.values.get(name);
    const value = stored === undefined ? def : stored;
    this.values.set(name, value);

    const min = opts.min ?? 0;
    const max = opts.max ?? Math.max(min + 1, def * 2 || min + 10);
    const step = opts.step ?? ((max - min) / 100 || 0.1);
    this.declared.push({ name, min, max, step, value });
    return value;
  }

  /** The API object injected into model code as `param`. */
  api(): ParamApi {
    return { number: (name, opts) => this.number(name, opts) };
  }

  set(name: string, value: number): void {
    this.values.set(name, value);
  }

  list(): ParamDecl[] {
    return this.declared;
  }

  /** Identity of the current control set, so the UI only rebuilds when it changes. */
  signature(): string {
    return this.declared
      .map((d) => `${d.name}:${d.min}:${d.max}:${d.step}`)
      .join("|");
  }
}
