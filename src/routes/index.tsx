import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

import { createEditor } from "@/editor";
import { defaultExample, examples } from "@/examples";
import {
  Shape,
  box,
  cube,
  cylinder,
  difference,
  intersection,
  meshKernel,
  sphere,
  union,
} from "@/facet";
import { loadWasmKernel } from "@/facet/wasmKernel";
import { ParamStore } from "@/params";
import { applyTheme, getInitialTheme } from "@/theme";
import { Viewport } from "@/viewport";

import type { FacetEditor } from "@/editor";
import type { Kernel, OpNode } from "@/facet";
import type { Theme } from "@/theme";
import "@/facet.css";

/** @knipignore */
export const Route = createFileRoute("/")({
  component: FacetStudio,
});

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

function FacetStudio() {
  const editorMount = useRef<HTMLDivElement>(null);
  const viewportMount = useRef<HTMLDivElement>(null);
  const paramsMount = useRef<HTMLDivElement>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  const exampleRef = useRef<HTMLSelectElement>(null);
  const kernelRef = useRef<HTMLSelectElement>(null);
  const themeBtnRef = useRef<HTMLButtonElement>(null);
  const themeLabelRef = useRef<HTMLSpanElement>(null);
  const exportRef = useRef<HTMLButtonElement>(null);
  const inited = useRef(false);

  useEffect(() => {
    if (inited.current) return; // guard StrictMode double-invoke
    inited.current = true;

    const store = new ParamStore();
    let theme: Theme = getInitialTheme();
    applyTheme(theme);

    const viewport = new Viewport(viewportMount.current!, theme);
    const kernels: Record<string, Kernel> = { ts: meshKernel };
    let activeKernel: Kernel = meshKernel;
    let currentNode: OpNode | null = null;
    let paramsSignature = " ";

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
          scheduleRun();
        });
        row.append(name, value, input);
        paramsEl.appendChild(row);
      }
    };

    const run = () => {
      const t0 = performance.now();
      const statusEl = statusRef.current!;
      try {
        const node = build(editor.getValue());
        const mesh = activeKernel.evaluate(node);
        viewport.setMesh(mesh);
        currentNode = node;
        renderParams();
        const ms = (performance.now() - t0).toFixed(0);
        statusEl.className = "status ok";
        statusEl.textContent = `✓ ${mesh.triangleCount.toLocaleString()} triangles · ${ms} ms · ${activeKernel.name}`;
      } catch (err) {
        currentNode = null;
        statusEl.className = "status err";
        statusEl.textContent = `✗ ${err instanceof Error ? err.message : String(err)}`;
      }
    };

    let timer: number | undefined;
    const scheduleRun = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(run, 200);
    };

    const editor: FacetEditor = createEditor(editorMount.current!, {
      doc: examples[defaultExample] ?? "",
      onChange: scheduleRun,
      theme,
    });

    const setTheme = (next: Theme) => {
      theme = next;
      applyTheme(theme);
      editor.setTheme(theme);
      viewport.setTheme(theme);
      themeLabelRef.current!.textContent = theme === "dark" ? "Dark" : "Light";
    };
    const toggleTheme = () => setTheme(theme === "dark" ? "light" : "dark");
    themeLabelRef.current!.textContent = theme === "dark" ? "Dark" : "Light";

    themeBtnRef.current!.addEventListener("click", toggleTheme);

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "t" && e.key !== "T") return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.closest(".cm-editor") ||
          ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName))
      ) {
        return;
      }
      e.preventDefault();
      toggleTheme();
    };
    window.addEventListener("keydown", onKey);

    exampleRef.current!.addEventListener("change", () => {
      editor.setValue(examples[exampleRef.current!.value] ?? "");
      run();
    });

    kernelRef.current!.addEventListener("change", () => {
      activeKernel = kernels[kernelRef.current!.value] ?? meshKernel;
      run();
    });

    exportRef.current!.addEventListener("click", () => {
      const statusEl = statusRef.current!;
      if (!currentNode) {
        statusEl.className = "status err";
        statusEl.textContent = "✗ Nothing to export - fix the model first.";
        return;
      }
      const stl = activeKernel.export(currentNode, "stl");
      const blob = new Blob([stl.buffer as ArrayBuffer], { type: "model/stl" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "facet-model.stl";
      a.click();
      URL.revokeObjectURL(url);
    });

    loadWasmKernel().then((rust) => {
      if (!rust) return;
      kernels.rust = rust;
      const opt = document.createElement("option");
      opt.value = "rust";
      opt.textContent = "Kernel: Rust/WASM";
      kernelRef.current?.appendChild(opt);
    });

    run();

    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="facet-app">
      <header>
        <span className="brand">
          🔶 <b>Facet</b>
        </span>
        <span className="tag">code CAD · write TypeScript, get geometry</span>
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
        </select>
        <select ref={kernelRef} title="Geometry kernel" defaultValue="ts">
          <option value="ts">Kernel: TS</option>
        </select>
        <button
          ref={themeBtnRef}
          type="button"
          className="icon-btn"
          title="Toggle light/dark"
        >
          <span ref={themeLabelRef}>Theme</span> <kbd className="kbd">T</kbd>
        </button>
        <button
          ref={exportRef}
          type="button"
          className="primary"
          title="Download STL"
        >
          Export STL
        </button>
      </header>

      <main className="facet-main">
        <section className="editor-pane">
          <div className="code" ref={editorMount} />
          <div className="status" ref={statusRef} />
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
        · part of the Omni ecosystem
      </footer>
    </div>
  );
}
