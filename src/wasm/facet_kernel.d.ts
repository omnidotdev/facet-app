/* tslint:disable */
/* eslint-disable */

/**
 * A flat, non-indexed triangle mesh handed back to JS as two Float32Arrays.
 */
export class MeshResult {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  readonly normals: Float32Array;
  readonly positions: Float32Array;
  readonly triangleCount: number;
}

/**
 * Evaluate a serialized op-graph into a triangle mesh.
 */
export function evaluate(op_json: string): MeshResult;

/**
 * The kernel identifier, mirrored into the app's kernel picker.
 */
export function name(): string;

export type InitInput =
  | RequestInfo
  | URL
  | Response
  | BufferSource
  | WebAssembly.Module;

export interface InitOutput {
  readonly memory: WebAssembly.Memory;
  readonly __wbg_meshresult_free: (a: number, b: number) => void;
  readonly evaluate: (a: number, b: number) => [number, number, number];
  readonly meshresult_normals: (a: number) => [number, number];
  readonly meshresult_positions: (a: number) => [number, number];
  readonly meshresult_triangleCount: (a: number) => number;
  readonly name: () => [number, number];
  readonly __wbindgen_externrefs: WebAssembly.Table;
  readonly __wbindgen_malloc: (a: number, b: number) => number;
  readonly __wbindgen_realloc: (
    a: number,
    b: number,
    c: number,
    d: number,
  ) => number;
  readonly __externref_table_dealloc: (a: number) => void;
  readonly __wbindgen_free: (a: number, b: number, c: number) => void;
  readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(
  module: { module: SyncInitInput } | SyncInitInput,
): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init(
  module_or_path?:
    | { module_or_path: InitInput | Promise<InitInput> }
    | InitInput
    | Promise<InitInput>,
): Promise<InitOutput>;
