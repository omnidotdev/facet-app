import { useEffect, useRef, useState } from "react";

import GeneratePanel from "@/components/ai/GeneratePanel";
import AccountControl from "@/components/auth/AccountControl";
import ExamplesMenu from "@/components/ExamplesMenu";
import { createEditor } from "@/editor";
import { defaultExample, examples, matchExample } from "@/examples";
import {
  KernelError,
  Shape,
  box,
  cube,
  cylinder,
  difference,
  grid,
  intersection,
  meshKernel,
  rectTube,
  requiresBrep,
  shouldAutoSwitchToBrep,
  sphere,
  union,
} from "@/facet";
import { loadBrepKernel } from "@/facet/brepKernel";
import { loadWasmKernel } from "@/facet/wasmKernel";
import { openModelFromFile, saveModelToFile } from "@/fileIo";
import { ParamStore } from "@/params";
import { loadWorkspace, saveWorkspace } from "@/storage";
import {
  activeTab,
  addTab,
  closeTab as closeTabState,
  createTabsState,
  renameTab,
  setActive,
  setActiveCode,
} from "@/tabs";
import { getTheme, subscribe, toggleTheme } from "@/themeStore";
import { Viewport } from "@/viewport";

import type { FacetEditor } from "@/editor";
import type { ExportFormat, Kernel, OpNode } from "@/facet";
import type { SavedWorkspace } from "@/storage";
import type { TabsState } from "@/tabs";
import type { Theme } from "@/theme";
import "@/facet.css";

// Value of the examples-dropdown placeholder, selected when the restored model
// is a custom edit that matches no named example
const CUSTOM_OPTION = "";

// Starter code for a brand-new tab, so it renders something immediately instead
// of opening onto a "must return a shape" error
const NEW_TAB_STARTER = "return cube(10);";

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
  /**
   * Open a fresh, empty tab (named from the prompt) and make it active, so a
   * generation lands in its own tab instead of overwriting the current model.
   */
  openGeneratedTab: (name: string) => void;
}

/**
 * The imperative Studio core (editor + viewport + run loop), exposed to the
 * React layer so tab switching and generation drive the one editor rather than
 * a parallel copy. React owns the tab list; the core owns the live document.
 */
interface StudioCore {
  /** The code currently in the editor (the live copy of the active tab). */
  getCode: () => string;
  /** Load a document into the editor, reset parameters, and run it. */
  openDoc: (code: string) => void;
  /** Replace the editor contents, run, and resolve with the run outcome. */
  loadCode: (code: string) => Promise<RunOutcome>;
  /** Persist the whole workspace (debounced). */
  save: () => void;
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
  grid,
  rectTube,
} as const;

export default function FacetStudio() {
  // Which pane the phone layout shows. Desktop ignores this (both panes show
  // side by side); on mobile the editor and the 3D viewport are full-screen tabs
  // so neither is cramped and the params overlay stops covering a tiny viewport
  const [mobileView, setMobileView] = useState<"code" | "view">("code");
  // Which named example the active model matches (or CUSTOM_OPTION for a custom
  // edit); drives the Examples menu's active marker. Kept in state (not a select
  // ref) so the menu reflects tab switches, restores, and generated tabs
  const [currentExample, setCurrentExample] = useState<string>(defaultExample);

  // The whole workspace (tabs + prefs) is restored once; the useState seed and
  // the setup effect share this object so they never disagree on the first model
  const initialWorkspaceRef = useRef<SavedWorkspace | null>(null);
  if (initialWorkspaceRef.current === null) {
    initialWorkspaceRef.current = loadWorkspace() ?? {
      ...createTabsState(examples[defaultExample] ?? ""),
      kernel: "ts",
      format: "stl",
    };
  }
  const initialWorkspace = initialWorkspaceRef.current;

  // React owns the open tabs (their names + which is active); the editor holds
  // the live code of the active tab, reconciled into state on any tab change
  const [tabsState, setTabsState] = useState<TabsState>(() => ({
    tabs: initialWorkspace.tabs,
    activeId: initialWorkspace.activeId,
  }));
  // A tab awaiting close confirmation, or null when no confirm is open
  const [closing, setClosing] = useState<{ id: string; name: string } | null>(
    null,
  );
  // Id of the tab currently being renamed inline, or null
  const [renaming, setRenaming] = useState<string | null>(null);
  // Set when a rename is cancelled with Escape, so the input's blur does not
  // then commit the edited value
  const renameSkipBlur = useRef(false);

  const editorMount = useRef<HTMLDivElement>(null);
  const viewportMount = useRef<HTMLDivElement>(null);
  const paramsMount = useRef<HTMLDivElement>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  const kernelRef = useRef<HTMLSelectElement>(null);
  const themeBtnRef = useRef<HTMLButtonElement>(null);
  const themeLabelRef = useRef<HTMLSpanElement>(null);
  const exportRef = useRef<HTMLButtonElement>(null);
  const formatRef = useRef<HTMLSelectElement>(null);
  const inited = useRef(false);
  // Populated once the editor + run loop are wired, so the AI panel can drive
  // them. Null until the setup effect runs (the panel only reads it on click)
  const studioHandle = useRef<StudioHandle | null>(null);
  // The imperative core, wired in the setup effect; null until then
  const coreRef = useRef<StudioCore | null>(null);
  // Mirror tab state into a ref so the core and handlers read the current value
  const tabsRef = useRef(tabsState);
  useEffect(() => {
    tabsRef.current = tabsState;
  }, [tabsState]);

  // Commit a new tab state to both React and the mirror ref in one place
  const commitTabs = (next: TabsState) => {
    tabsRef.current = next;
    setTabsState(next);
  };

  // Switch to another open tab: capture the active editor content first (the
  // editor is the live copy), then load the target tab's code
  const switchTab = (id: string) => {
    const core = coreRef.current;
    const current = tabsRef.current;
    if (!core || id === current.activeId) return;
    const saved = setActiveCode(current, core.getCode());
    const target = saved.tabs.find((t) => t.id === id);
    commitTabs(setActive(saved, id));
    core.openDoc(target?.code ?? "");
    core.save();
  };

  // Open a new tab after the active one, seeded with a starter model, and
  // switch to it
  const newTab = () => {
    const core = coreRef.current;
    if (!core) return;
    const captured = setActiveCode(tabsRef.current, core.getCode());
    const { state } = addTab(captured, NEW_TAB_STARTER);
    commitTabs(state);
    core.openDoc(NEW_TAB_STARTER);
    core.save();
  };

  // Remove a tab, picking a neighbour active when it was the active one
  const doCloseTab = (id: string) => {
    const core = coreRef.current;
    const current = core
      ? setActiveCode(tabsRef.current, core.getCode())
      : tabsRef.current;
    const wasActive = current.activeId === id;
    const next = closeTabState(current, id);
    commitTabs(next);
    setClosing(null);
    if (wasActive) core?.openDoc(activeTab(next)?.code ?? "");
    core?.save();
  };

  // Closing a model is irreversible, so confirm first, unless the tab is blank
  // (nothing to lose)
  const requestCloseTab = (id: string) => {
    const current = tabsRef.current;
    const tab = current.tabs.find((t) => t.id === id);
    if (!tab) return;
    const code =
      id === current.activeId && coreRef.current
        ? coreRef.current.getCode()
        : tab.code;
    if (code.trim().length === 0) {
      doCloseTab(id);
      return;
    }
    setClosing({ id, name: tab.name });
  };

  // Commit an inline tab rename (empty/whitespace names are ignored by
  // renameTab, so the old name is kept)
  const commitRename = (id: string, name: string) => {
    commitTabs(renameTab(tabsRef.current, id, name));
    setRenaming(null);
    coreRef.current?.save();
  };

  // Open a named example in its own new tab, so it never overwrites the model
  // the user is already working on
  const loadExample = (name: string) => {
    const code = examples[name];
    const core = coreRef.current;
    // Ignore the neutral "Custom model" placeholder, which names no example
    if (code === undefined || !core) return;
    const captured = setActiveCode(tabsRef.current, core.getCode());
    const { state } = addTab(captured, code, name);
    commitTabs(state);
    core.openDoc(code);
    core.save();
  };

  // Open a fresh tab for an AI generation to land in, non-destructively
  const openGeneratedTab = (name: string) => {
    const core = coreRef.current;
    if (!core) return;
    const captured = setActiveCode(tabsRef.current, core.getCode());
    const { state } = addTab(captured, "", name.trim() || undefined);
    commitTabs(state);
    core.openDoc("");
    core.save();
  };

  // Open a model source file (.facet.ts) into its own new tab, named from the
  // file, mirroring how an example is opened so it never overwrites the model
  const openFileIntoTab = (name: string, code: string) => {
    const core = coreRef.current;
    if (!core) return;
    const captured = setActiveCode(tabsRef.current, core.getCode());
    const { state } = addTab(captured, code, name);
    commitTabs(state);
    core.openDoc(code);
    core.save();
  };

  // Save the active model's source to a .facet.ts file (native picker where
  // available, else a download); the file name comes from the active tab
  const handleSaveFile = () => {
    const core = coreRef.current;
    if (!core) return;
    const name = activeTab(tabsRef.current)?.name ?? "model";
    void saveModelToFile(name, core.getCode());
  };

  // Open a .facet.ts (or .ts) file into a new tab
  const handleOpenFile = () => {
    void openModelFromFile().then((opened) => {
      if (opened) openFileIntoTab(opened.name, opened.code);
    });
  };

  // Cmd/Ctrl+S saves the model source; Cmd/Ctrl+O opens one, each overriding
  // the browser default. Bound once; the handlers read live refs
  // biome-ignore lint/correctness/useExhaustiveDependencies: handlers read live refs, so bind the listener once
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) {
        return;
      }
      const key = event.key.toLowerCase();
      if (key === "s") {
        event.preventDefault();
        handleSaveFile();
      } else if (key === "o") {
        event.preventDefault();
        handleOpenFile();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Keep the AI panel's handle pointing at fresh closures every render; it is
  // only read on a user click, long after the core is wired
  useEffect(() => {
    studioHandle.current = {
      getCode: () => coreRef.current?.getCode() ?? "",
      loadCode: (code) =>
        coreRef.current?.loadCode(code) ??
        Promise.resolve<RunOutcome>({
          ok: false,
          error: "The Studio is not ready yet.",
        }),
      openGeneratedTab,
    };
  });

  // Let Escape dismiss the close-confirm dialog
  useEffect(() => {
    if (!closing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setClosing(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closing]);

  // F2 renames the active tab (the common editor/file-tab shortcut). Ignored
  // while already renaming, so the inline input keeps focus
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F2" && !renaming) {
        e.preventDefault();
        setRenaming(tabsRef.current.activeId);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [renaming]);

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

    // The restored workspace (shared with the useState seed above).
    const workspace = initialWorkspaceRef.current!;
    // The model the editor opens with: the active tab's code.
    const initialDoc =
      workspace.tabs.find((t) => t.id === workspace.activeId)?.code ?? "";

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

        if (d.kind === "number") {
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
        } else if (d.kind === "boolean") {
          const input = document.createElement("input");
          input.type = "checkbox";
          input.className = "param-checkbox";
          input.checked = d.value;
          input.addEventListener("change", () => {
            store.set(d.name, input.checked);
            scheduleLive();
          });
          row.append(name, input);
        } else {
          const select = document.createElement("select");
          select.className = "param-select";
          for (const opt of d.options) {
            const option = document.createElement("option");
            option.value = opt;
            option.textContent = opt;
            if (opt === d.value) option.selected = true;
            select.appendChild(option);
          }
          select.addEventListener("change", () => {
            store.set(d.name, select.value);
            scheduleLive();
          });
          row.append(name, select);
        }

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

    // Autosave the whole workspace (all tabs + prefs), debounced, so work
    // survives a reload. The editor holds the active tab's live code, so fold
    // that into the stored tabs. Declared before the editor so it can read it.
    let editor: FacetEditor;
    let saveTimer: number | undefined;
    const saveSoon = () => {
      window.clearTimeout(saveTimer);
      saveTimer = window.setTimeout(() => {
        const ws = tabsRef.current;
        const liveCode = editor.getValue();
        const tabs = ws.tabs.map((t) =>
          t.id === ws.activeId ? { ...t, code: liveCode } : t,
        );
        saveWorkspace({
          tabs,
          activeId: ws.activeId,
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
    if (formatRef.current) formatRef.current.value = workspace.format;
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
    setCurrentExample(matchExample(initialDoc) ?? CUSTOM_OPTION);

    // Load a document into the editor, re-seeding parameters from scratch (so a
    // new model never carries over the previous model's tuned values by shared
    // name), and point the examples dropdown at its match. Shared by tab
    // switching, the examples dropdown, and opening a generated tab.
    const openDoc = (code: string) => {
      store.reset();
      paramsSignature = " ";
      editor.setValue(code);
      setCurrentExample(matchExample(code) ?? CUSTOM_OPTION);
      run(true);
    };

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
      if (workspace.kernel === "rust" && kernelRef.current) {
        kernelRef.current.value = "rust";
        activeKernel = rust;
        activeKernelKey = "rust";
        run();
      }
    });

    // Expose the editor + run loop so React drives the same path. loadCode is
    // the generation entry point (replace + run, resolving the outcome for the
    // repair loop); openDoc is the tab/example entry point (replace + reset
    // params + run)
    coreRef.current = {
      getCode: () => editor.getValue(),
      openDoc,
      loadCode: (code) =>
        new Promise<RunOutcome>((resolve) => {
          editor.setValue(code);
          setCurrentExample(matchExample(code) ?? CUSTOM_OPTION);
          run(true, resolve);
        }),
      save: saveSoon,
    };

    run(true);

    // Restore a saved B-rep selection by driving the same on-demand load path
    if (workspace.kernel === "brep" && kernelRef.current) {
      kernelRef.current.value = "brep";
      selectKernel("brep");
    }

    return () => unsubscribeTheme();
  }, []);

  return (
    <div className="facet-app">
      <header>
        <span className="brand">
          <img
            className="brand-mark"
            src="/mark.svg"
            alt=""
            width={20}
            height={20}
          />
          <b>Facet</b>
        </span>
        <span className="tag">code CAD · write code, get geometry</span>
        <div className="header-controls">
          <GeneratePanel handle={studioHandle} />
          <ExamplesMenu
            names={Object.keys(examples)}
            current={currentExample}
            onSelect={loadExample}
          />
          <button
            type="button"
            className="icon-btn"
            title="Open a model file (.facet.ts)"
            onClick={handleOpenFile}
          >
            Open
          </button>
          <button
            type="button"
            className="icon-btn"
            title="Save model source to a .facet.ts file"
            onClick={handleSaveFile}
          >
            Save
          </button>
          <select
            ref={kernelRef}
            className="kernel-select"
            title="Geometry kernel"
            defaultValue="ts"
          >
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
          <AccountControl />
        </div>
      </header>

      <div className="doc-tabs" role="tablist" aria-label="Open models">
        {tabsState.tabs.map((tab) => (
          <span
            key={tab.id}
            className="doc-tab"
            data-active={tab.id === tabsState.activeId}
          >
            {renaming === tab.id ? (
              <input
                className="doc-tab-rename"
                defaultValue={tab.name}
                aria-label={`Rename ${tab.name}`}
                maxLength={60}
                spellCheck={false}
                // biome-ignore lint/a11y/noAutofocus: focus the rename field the instant it opens
                autoFocus
                onFocus={(e) => e.currentTarget.select()}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitRename(tab.id, e.currentTarget.value);
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    renameSkipBlur.current = true;
                    setRenaming(null);
                  }
                }}
                onBlur={(e) => {
                  if (renameSkipBlur.current) {
                    renameSkipBlur.current = false;
                    return;
                  }
                  commitRename(tab.id, e.currentTarget.value);
                }}
              />
            ) : (
              <button
                type="button"
                role="tab"
                aria-selected={tab.id === tabsState.activeId}
                className="doc-tab-label"
                onClick={() => switchTab(tab.id)}
                onDoubleClick={() => setRenaming(tab.id)}
                title={`${tab.name} (double-click or F2 to rename)`}
              >
                {tab.name}
              </button>
            )}
            <button
              type="button"
              className="doc-tab-close"
              aria-label={`Close ${tab.name}`}
              onClick={() => requestCloseTab(tab.id)}
            >
              ✕
            </button>
          </span>
        ))}
        <button
          type="button"
          className="doc-tab-new"
          aria-label="New model"
          title="New model"
          onClick={newTab}
        >
          ＋
        </button>
      </div>

      <div className="mobile-tabs" role="tablist" aria-label="View">
        <button
          type="button"
          role="tab"
          className="mobile-tab"
          aria-selected={mobileView === "code"}
          data-active={mobileView === "code"}
          onClick={() => setMobileView("code")}
        >
          Code
        </button>
        <button
          type="button"
          role="tab"
          className="mobile-tab"
          aria-selected={mobileView === "view"}
          data-active={mobileView === "view"}
          onClick={() => setMobileView("view")}
        >
          3D
        </button>
      </div>

      <main className="facet-main" data-mobile-view={mobileView}>
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
        in partnership with{" "}
        <a href="https://matterforge.io" target="_blank" rel="noreferrer">
          MatterForge
        </a>
      </footer>

      {closing ? (
        <div
          className="ai-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Close model"
        >
          <div className="ai-modal confirm-modal">
            <div className="ai-modal-head">
              <span className="ai-title">Close “{closing.name}”?</span>
            </div>
            <p className="ai-help">
              This model will be removed from your workspace and cannot be
              recovered.
            </p>
            <div className="ai-actions confirm-actions">
              <button type="button" onClick={() => setClosing(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="danger"
                onClick={() => doCloseTab(closing.id)}
              >
                Close model
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
