import { useEffect, useRef } from "react";

import GeneratePanel from "@/components/ai/GeneratePanel";
import { createEditor } from "@/editor";
import { defaultExample, examples, matchExample } from "@/examples";
import {
  KernelError,
  Shape,
  box,
  cube,
  cylinder,
  difference,
  intersection,
  meshKernel,
  requiresBrep,
  shouldAutoSwitchToBrep,
  sphere,
  union,
} from "@/facet";
import { loadBrepKernel } from "@/facet/brepKernel";
import { loadWasmKernel } from "@/facet/wasmKernel";
import { ParamStore } from "@/params";
import { loadProject, saveProject } from "@/storage";
import { getTheme, subscribe, toggleTheme } from "@/themeStore";
import { Viewport } from "@/viewport";

import type { FacetEditor } from "@/editor";
import type { ExportFormat, Kernel, OpNode } from "@/facet";
import type { Theme } from "@/theme";
import "@/facet.css";

// Value of the examples-dropdown placeholder, selected when the restored model
// is a custom edit that matches no named example
const CUSTOM_OPTION = "";

/**
 * Terminal outcome of a run, reported to a caller that drives the editor (the
 * AI repair loop) so it can react to a kernel error without parsing the status
 * line. Mirrors the real build + evaluate path, including the async B-rep
 * auto-switch.
 */
export type RunOutcome = { ok: true } | { ok: false; error: string };

/**
 * Imperative handle the Studio exposes so the AI panel can drive the SAME
 * editor + run path the rest of the Studio uses, rather than a parallel one.
 */
export interface StudioHandle {
  /** The code currently in the editor. */
  getCode: () => string;
  /** Replace the editor contents, run, and resolve with the run outcome. */
  loadCode: (code: string) => Promise<RunOutcome>;
}

// The API surface injected into user model code.
const api = {
  cube,
  box,
  sphere,
  cylinder,
  union,
  difference,
  intersection,
} as const;

export default function FacetStudio() {
  const editorMount = useRef<HTMLDivElement>(null);
  const viewportMount = useRef<HTMLDivElement>(null);
  const paramsMount = useRef<HTMLDivElement>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  const exampleRef = useRef<HTMLSelectElement>(null);
  const kernelRef = useRef<HTMLSelectElement>(null);
  const themeBtnRef = useRef<HTMLButtonElement>(null);
  const themeLabelRef = useRef<HTMLSpanElement>(null);
  const exportRef = useRef<HTMLButtonElement>(null);
  const formatRef = useRef<HTMLSelectElement>(null);
  const inited = useRef(false);
  // Populated once the editor + run loop are wired, so the AI panel can drive
  // them. Null until the setup effect runs (the panel only reads it on click)
  const studioHandle = useRef<StudioHandle | null>(null);

  useEffect(() => {
    if (inited.current) return; // guard StrictMode double-invoke
    inited.current = true;

    const store = new ParamStore();
    // The theme is stamped on <html> at app boot (main.tsx initTheme). Read the
    // current value to seed the viewport and editor.
    const initialTheme = getTheme();

    const viewport = new Viewport(viewportMount.current!, initialTheme);
    const kernels: Record<string, Kernel> = { ts: meshKernel };
    let activeKernel: Kernel = meshKernel;
    let activeKernelKey = "ts";
    // Guards a second click while the on-demand B-rep wasm is still fetching
    let brepLoading = false;
    // Set when run() triggers an automatic switch to B-rep, so the first render
    // on the newly active kernel can explain why the kernel changed
    let announceAutoSwitch = false;
    let currentNode: OpNode | null = null;
    let paramsSignature = " ";

    // Restore the last session (model + prefs) if one was saved.
    const saved = loadProject();
    // The model the editor opens with: the saved code, else the default example.
    const initialDoc = saved?.code ?? examples[defaultExample] ?? "";

    const build = (code: string): OpNode => {
      store.begin();
      const names = [...Object.keys(api), "param"];
      // biome-ignore lint/security/noGlobalEval: MVP eval; P1b moves this to a sandboxed worker + esbuild
      const fn = new Function(...names, `"use strict";\n${code}`);
      const result = fn(...Object.values(api), store.api());
      if (!(result instanceof Shape)) {
        throw new Error(
          "Your model must `return` a shape (e.g. `return cube(10);`).",
        );
      }
      return result.node;
    };

    const renderParams = () => {
      const paramsEl = paramsMount.current!;
      const decls = store.list();
      const sig = store.signature();
      if (sig === paramsSignature) return;
      paramsSignature = sig;

      paramsEl.textContent = "";
      paramsEl.hidden = decls.length === 0;
      if (!decls.length) return;

      const title = document.createElement("div");
      title.className = "params-title";
      title.textContent = "Parameters";
      paramsEl.appendChild(title);

      for (const d of decls) {
        const row = document.createElement("label");
        row.className = "param-row";
        const name = document.createElement("span");
        name.className = "param-name";
        name.textContent = d.name;
        const value = document.createElement("span");
        value.className = "param-value";
        value.textContent = String(d.value);
        const input = document.createElement("input");
        input.type = "range";
        input.min = String(d.min);
        input.max = String(d.max);
        input.step = String(d.step);
        input.value = String(d.value);
        input.addEventListener("input", () => {
          store.set(d.name, Number(input.value));
          value.textContent = input.value;
          scheduleLive();
        });
        row.append(name, value, input);
        paramsEl.appendChild(row);
      }
    };

    const run = (reframe = false, onResult?: (outcome: RunOutcome) => void) => {
      const t0 = performance.now();
      const statusEl = statusRef.current!;
      let node: OpNode;
      try {
        node = build(editor.getValue());
      } catch (err) {
        currentNode = null;
        const message = err instanceof Error ? err.message : String(err);
        statusEl.className = "status err";
        statusEl.textContent = `✗ ${message}`;
        onResult?.({ ok: false, error: message });
        return;
      }

      // Fillet/chamfer/shell exist only on the B-rep (OCCT) kernel, so load and
      // switch to it on demand rather than erroring on the mesh/Rust kernel.
      // activateBrepKernel flips activeKernelKey to "brep" before it re-runs, so
      // this branch cannot re-trigger itself and cause a switch loop. Thread
      // onResult through so a caller sees the outcome of the post-switch run
      if (shouldAutoSwitchToBrep(node, activeKernelKey)) {
        announceAutoSwitch = true;
        activateBrepKernel(reframe, onResult);
        return;
      }

      try {
        const mesh = activeKernel.evaluate(node);
        viewport.setMesh(mesh, reframe);
        currentNode = node;
        renderParams();
        if (announceAutoSwitch && requiresBrep(node)) {
          // First successful render of a B-rep model after an automatic switch:
          // say why the kernel changed, then fall back to the usual stats. Gate
          // on requiresBrep so a failed first eval cannot mislabel a later
          // non-B-rep render with the switch notice
          announceAutoSwitch = false;
          statusEl.className = "status ok";
          statusEl.textContent =
            "✓ Using the B-rep kernel for fillet/chamfer/shell";
        } else {
          const ms = (performance.now() - t0).toFixed(0);
          statusEl.className = "status ok";
          statusEl.textContent = `✓ ${mesh.triangleCount.toLocaleString()} triangles · ${ms} ms · ${activeKernel.name}`;
        }
        onResult?.({ ok: true });
      } catch (err) {
        currentNode = null;
        const message = err instanceof Error ? err.message : String(err);
        statusEl.className = "status err";
        statusEl.textContent = `✗ ${message}`;
        onResult?.({ ok: false, error: message });
      }
    };

    // Editor edits re-eval arbitrary code, so debounce them while typing.
    let timer: number | undefined;
    const scheduleRun = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => run(), 200);
    };

    // Slider drags only change a value on an already-valid model (a few ms to
    // recompute), so run live, coalesced to one recompute per animation frame
    // for instant feedback without reframing the camera.
    let liveRaf: number | undefined;
    const scheduleLive = () => {
      if (liveRaf !== undefined) return;
      liveRaf = requestAnimationFrame(() => {
        liveRaf = undefined;
        run();
      });
    };

    // Autosave the working model + prefs (debounced) so work survives a reload.
    // Declared before the editor so the saver can read it.
    let editor: FacetEditor;
    let saveTimer: number | undefined;
    const saveSoon = () => {
      window.clearTimeout(saveTimer);
      saveTimer = window.setTimeout(() => {
        saveProject({
          code: editor.getValue(),
          kernel: kernelRef.current?.value ?? "ts",
          format: formatRef.current?.value ?? "stl",
        });
      }, 400);
    };

    editor = createEditor(editorMount.current!, {
      doc: initialDoc,
      onChange: () => {
        scheduleRun();
        saveSoon();
      },
      theme: initialTheme,
    });
    if (formatRef.current) formatRef.current.value = saved?.format ?? "stl";
    formatRef.current?.addEventListener("change", saveSoon);

    // The shared command palette owns the theme store and the `t` hotkey
    // fleet-wide. The Studio subscribes so the viewport, editor, and label
    // re-theme whoever flips it (the palette action, the `t` hotkey, or this
    // button), keeping the imperative viewport/editor in sync with the store.
    const syncThemeLabel = (next: Theme) => {
      themeLabelRef.current!.textContent = next === "dark" ? "Dark" : "Light";
    };
    syncThemeLabel(initialTheme);

    const unsubscribeTheme = subscribe((next) => {
      editor.setTheme(next);
      viewport.setTheme(next);
      syncThemeLabel(next);
    });

    themeBtnRef.current!.addEventListener("click", toggleTheme);

    // The restored model is not necessarily a named example (it may be a custom
    // edit, which storage keeps as code only). Point the dropdown at the example
    // whose source matches, or at the neutral "Custom model" option otherwise,
    // so a reload never falsely implies the first example is loaded.
    if (exampleRef.current) {
      exampleRef.current.value = matchExample(initialDoc) ?? CUSTOM_OPTION;
    }

    exampleRef.current!.addEventListener("change", () => {
      const code = examples[exampleRef.current!.value];
      // Ignore the neutral "Custom model" placeholder, which names no example
      if (code === undefined) return;
      editor.setValue(code);
      run(true);
    });

    // Load (once, on demand) and activate the B-rep (OCCT) kernel, then re-run.
    // Shared by the manual dropdown and the automatic switch for B-rep-only ops.
    // The kernel is a ~6.9 MB gzipped wasm, so it is never loaded at boot: the
    // first time it is needed, fetch it, keep the current kernel live while it
    // fetches, and fall back if it fails. The dropdown is moved to "brep" up
    // front so a switch away during the load is respected (manual path) and the
    // pending switch is visible (auto path)
    const activateBrepKernel = (
      reframe = false,
      onResult?: (outcome: RunOutcome) => void,
    ) => {
      const statusEl = statusRef.current!;
      if (kernelRef.current) kernelRef.current.value = "brep";
      if (kernels.brep) {
        activeKernel = kernels.brep;
        activeKernelKey = "brep";
        run(reframe, onResult);
        saveSoon();
        return;
      }
      if (brepLoading) {
        // A fetch is already in flight and will re-run, but it does not carry
        // this caller's onResult, so settle it to avoid a hung repair loop
        onResult?.({
          ok: false,
          error: "The B-rep kernel is still loading. Try again in a moment.",
        });
        return;
      }
      brepLoading = true;
      statusEl.className = "status";
      statusEl.textContent = "Loading B-rep kernel…";
      loadBrepKernel().then((brep) => {
        brepLoading = false;
        if (!brep) {
          // Keep running on the kernel that was active before the switch
          announceAutoSwitch = false;
          const message = "The B-rep kernel could not be loaded.";
          statusEl.className = "status err";
          statusEl.textContent = `✗ ${message}`;
          if (kernelRef.current) kernelRef.current.value = activeKernelKey;
          onResult?.({ ok: false, error: message });
          return;
        }
        // Cache it regardless, but only activate if the dropdown has not been
        // switched away while the wasm was loading
        kernels.brep = brep;
        if (kernelRef.current?.value !== "brep") {
          onResult?.({
            ok: false,
            error: "The kernel was switched before the model could render.",
          });
          return;
        }
        activeKernel = brep;
        activeKernelKey = "brep";
        run(reframe, onResult);
        saveSoon();
      });
    };

    // Switch the active kernel from an explicit dropdown choice. B-rep goes
    // through the on-demand loader; the mesh/Rust kernels are already resident
    const selectKernel = (value: string) => {
      if (value === "brep") {
        activateBrepKernel();
        return;
      }
      activeKernel = kernels[value] ?? meshKernel;
      activeKernelKey = kernels[value] ? value : "ts";
      run();
      saveSoon();
    };

    kernelRef.current!.addEventListener("change", () => {
      selectKernel(kernelRef.current!.value);
    });

    exportRef.current!.addEventListener("click", () => {
      const statusEl = statusRef.current!;
      if (!currentNode) {
        statusEl.className = "status err";
        statusEl.textContent = "✗ Nothing to export - fix the model first.";
        return;
      }
      const format = (formatRef.current?.value ?? "stl") as ExportFormat;
      const mime =
        format === "3mf"
          ? "model/3mf"
          : format === "step"
            ? "model/step"
            : "model/stl";
      try {
        const data = activeKernel.export(currentNode, format);
        const blob = new Blob([data.buffer as ArrayBuffer], { type: mime });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        // Lowercase extension, so facet-model.step for a STEP export
        a.download = `facet-model.${format}`;
        a.click();
        URL.revokeObjectURL(url);
      } catch (err) {
        // Only a KernelError carries a message written for the user (e.g. STEP
        // on a mesh kernel, or a model with no exact B-rep); any other failure
        // is an internal detail, so log it and show a generic message
        statusEl.className = "status err";
        if (err instanceof KernelError) {
          statusEl.textContent = `✗ ${err.message}`;
        } else {
          console.warn("Facet export failed:", err);
          statusEl.textContent = "✗ Export failed.";
        }
      }
    });

    loadWasmKernel().then((rust) => {
      if (!rust) return;
      kernels.rust = rust;
      const opt = document.createElement("option");
      opt.value = "rust";
      opt.textContent = "Kernel: Rust/WASM";
      kernelRef.current?.appendChild(opt);
      // Restore a saved Rust selection once the option exists.
      if (saved?.kernel === "rust" && kernelRef.current) {
        kernelRef.current.value = "rust";
        activeKernel = rust;
        activeKernelKey = "rust";
        run();
      }
    });

    // Expose the editor + run loop so the AI panel drives the same path. Load
    // generated code exactly as the examples dropdown does (set, point the
    // dropdown at its matching example or the neutral "Custom model" state,
    // then run), and resolve with the run outcome for the repair loop
    studioHandle.current = {
      getCode: () => editor.getValue(),
      loadCode: (code) =>
        new Promise<RunOutcome>((resolve) => {
          editor.setValue(code);
          if (exampleRef.current) {
            exampleRef.current.value = matchExample(code) ?? CUSTOM_OPTION;
          }
          run(true, resolve);
        }),
    };

    run(true);

    // Restore a saved B-rep selection by driving the same on-demand load path
    if (saved?.kernel === "brep" && kernelRef.current) {
      kernelRef.current.value = "brep";
      selectKernel("brep");
    }

    return () => unsubscribeTheme();
  }, []);

  return (
    <div className="facet-app">
      <header>
        <span className="brand">
          🔶 <b>Facet</b>
        </span>
        <span className="tag">code CAD · write code, get geometry</span>
        <span className="spacer" />
        <select
          ref={exampleRef}
          title="Load an example"
          defaultValue={defaultExample}
        >
          {Object.keys(examples).map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
          <option value={CUSTOM_OPTION}>Custom model</option>
        </select>
        <select ref={kernelRef} title="Geometry kernel" defaultValue="ts">
          <option value="ts">Kernel: TS</option>
          <option value="brep">Kernel: B-rep (OCCT)</option>
        </select>
        <button
          ref={themeBtnRef}
          type="button"
          className="icon-btn"
          title="Toggle light/dark"
        >
          <span ref={themeLabelRef}>Theme</span> <kbd className="kbd">T</kbd>
        </button>
        <select ref={formatRef} title="Export format" defaultValue="stl">
          <option value="stl">STL</option>
          <option value="3mf">3MF</option>
          <option value="step">STEP</option>
        </select>
        <button
          ref={exportRef}
          type="button"
          className="primary"
          title="Download the model"
        >
          Export
        </button>
      </header>

      <main className="facet-main">
        <section className="editor-pane">
          <div className="code" ref={editorMount} />
          <div className="status" ref={statusRef} />
          <GeneratePanel handle={studioHandle} />
        </section>
        <section className="viewport">
          <div className="viewport-canvas" ref={viewportMount} />
          <div className="params" ref={paramsMount} hidden />
        </section>
      </main>

      <footer>
        Made with <span className="mark">🔶</span> by{" "}
        <a href="https://omni.dev" target="_blank" rel="noreferrer">
          Omni
        </a>{" "}
        in partnership with{" "}
        <a href="https://matterforge.io" target="_blank" rel="noreferrer">
          MatterForge
        </a>
      </footer>
    </div>
  );
}
