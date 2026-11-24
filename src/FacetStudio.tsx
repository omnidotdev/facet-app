import { NativeSelect } from "@omnidotdev/thornberry/native-select";
import { Box, Focus, House, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import GeneratePanel from "@/components/ai/GeneratePanel";
import AccountControl from "@/components/auth/AccountControl";
import ExamplesMenu from "@/components/ExamplesMenu";
import ImportArtButton from "@/components/ImportArtButton";
import PaneSplitter from "@/components/PaneSplitter";
import { RENDER_MODE_ICONS } from "@/components/renderModeIcons";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import ViewNavButton from "@/components/ViewNavButton";
import { createEditor } from "@/editor";
import { defaultExample, examples, matchExample } from "@/examples";
import {
  KernelError,
  brepNeed,
  meshKernel,
  shouldAutoSwitchToBrep,
} from "@/facet";
import { loadBrepWorkerKernel } from "@/facet/brepWorkerClient";
import { evaluateColored, exportColored } from "@/facet/colors";
import { ModelRunner } from "@/facet/modelRunner";
import { loadWasmKernel } from "@/facet/wasmKernel";
import { exportFileName, openModelFromFile, saveModelToFile } from "@/fileIo";
import {
  loadRendererPreference,
  parseRendererPreference,
  rendererLabel,
  saveRendererPreference,
} from "@/gpu/rendererPreference";
import {
  RENDER_MODE_LABELS,
  loadRenderMode,
  nextRenderMode,
  saveRenderMode,
} from "@/gpu/renderMode";
import { VIEW_KEYS } from "@/gpu/views";
import { ParamStore, formatParamNumber, parseParamInput } from "@/params";
import { createRunWaiters } from "@/runWaiters";
import {
  loadInvertDrag,
  loadParamsCollapsed,
  loadWorkspace,
  saveInvertDrag,
  saveParamsCollapsed,
  saveWorkspace,
} from "@/storage";
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
import { registerViewControl } from "@/viewControl";
import { Viewport } from "@/viewport";

import type { FacetEditor } from "@/editor";
import type { ExportFormat, Kernel, OpNode } from "@/facet";
import type { AsyncKernel } from "@/facet/kernel";
import type { BrepNeed } from "@/facet/opgraph";
import type { RendererKind } from "@/gpu/backend";
import type { RendererPreference } from "@/gpu/rendererPreference";
import type { RenderMode } from "@/gpu/renderMode";
import type { ParamValue } from "@/params";
import type { SavedWorkspace } from "@/storage";
import type { TabsState } from "@/tabs";
import type { Theme } from "@/theme";
import type { Projection, ViewportCapture } from "@/viewport";
import "@/facet.css";

// Value of the examples-dropdown placeholder, selected when the restored model
// is a custom edit that matches no named example
const CUSTOM_OPTION = "";

// Starter code for a brand-new tab, so it renders something immediately instead
// of opening onto a "must return a shape" error
const NEW_TAB_STARTER = "return cube(10);";

// What the status line names when a model switches to the B-rep kernel
const BREP_NEED_LABELS: Record<BrepNeed, string> = {
  fillet: "fillets, chamfers, and shells",
  text: "text",
  svg: "SVG shapes",
  sketch: "combined 2D sketches",
};

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
  /**
   * Replace the editor contents, run, and resolve with the run outcome. With
   * `params`, the parameter values are replaced by those first (an empty
   * object puts every parameter at its declared default)
   */
  loadCode: (
    code: string,
    params?: Record<string, ParamValue>,
  ) => Promise<RunOutcome>;
  /** The values the open model's parameters are set to, by name */
  getParams: () => Record<string, ParamValue>;
  /**
   * Open a fresh, empty tab (named from the prompt) and make it active, so a
   * generation lands in its own tab instead of overwriting the current model.
   */
  openGeneratedTab: (name: string) => void;
  /**
   * The active tab's id, so a change requested for one tab is never applied to
   * another the user switched to while it was being made
   */
  getTabId: () => string;
  /**
   * Capture the current 3D view as a PNG for the AI critique loop. Resolves
   * null when there is nothing to capture (no WebGPU, no model) or the readback
   * fails or comes back blank.
   */
  capture: () => Promise<ViewportCapture | null>;
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
  /**
   * Replace the editor contents, run, and resolve with the run outcome,
   * replacing the parameter values with `params` first when given
   */
  loadCode: (
    code: string,
    params?: Record<string, ParamValue>,
  ) => Promise<RunOutcome>;
  /** The values the open model's parameters are set to, by name */
  getParams: () => Record<string, ParamValue>;
  /** Persist the whole workspace (debounced). */
  save: () => void;
}

export default function FacetStudio() {
  // Which pane the phone layout shows. Desktop ignores this (both panes show
  // side by side); on mobile the editor and the 3D viewport are full-screen tabs
  // so neither is cramped and the params overlay stops covering a tiny viewport
  const [mobileView, setMobileView] = useState<"code" | "view">("code");
  // Where the AI panel docks its chat for changing the open part
  const [chatMount, setChatMount] = useState<HTMLDivElement | null>(null);
  // Which named example the active model matches (or CUSTOM_OPTION for a custom
  // edit); drives the Examples menu's active marker. Kept in state (not a select
  // ref) so the menu reflects tab switches, restores, and generated tabs
  const [currentExample, setCurrentExample] = useState<string>(defaultExample);
  // The header's preference controls (kernel, theme, export format) live in a
  // Settings dropdown so the top bar stays uncluttered on every width
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);
  // Renderer choice (saved per browser) and the one actually drawing, shown on
  // the viewport so it is always clear whether the preview runs on WebGPU or
  // the WebGL compatibility path
  const [rendererPref, setRendererPref] = useState<RendererPreference>(
    loadRendererPreference,
  );
  const [activeRenderer, setActiveRenderer] = useState<RendererKind | null>(
    null,
  );
  // Which way a drag orbits the view (saved per browser)
  const [invertDrag, setInvertDrag] = useState(loadInvertDrag);
  // How the solid is drawn (saved per browser); the viewport owns the value
  // and reports changes from its Z key, the button, and the palette
  const [renderMode, setRenderMode] = useState<RenderMode>(loadRenderMode);
  // The editor and 3D view grid, which the pane splitter resizes
  const mainRef = useRef<HTMLElement>(null);

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
  // Retains the closing tab's name so the confirm dialog's title stays stable
  // through its close animation (when `closing` has already been cleared)
  const closingNameRef = useRef("");
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
  // Where the viewport draws its navigation gizmo
  const gizmoMount = useRef<HTMLDivElement>(null);
  // Mirrors the viewport's projection for the toggle button
  const [projection, setProjection] = useState<Projection>("perspective");
  // The live Viewport instance, so the AI handle can capture the current render
  const viewportRef = useRef<Viewport | null>(null);
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
      if (!opened) return; // the user cancelled the picker
      if (!opened.ok) {
        // Not a valid Facet model (wrong type, binary, or too large)
        const statusEl = statusRef.current;
        if (statusEl) {
          statusEl.className = "status err";
          statusEl.textContent = `✗ ${opened.error}`;
        }
        return;
      }
      openFileIntoTab(opened.name, opened.code);
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

  // Close the Settings dropdown on an outside click, like a native menu
  useEffect(() => {
    if (!settingsOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (
        settingsRef.current &&
        !settingsRef.current.contains(event.target as Node)
      ) {
        setSettingsOpen(false);
      }
    };
    window.addEventListener("mousedown", onPointerDown);
    return () => window.removeEventListener("mousedown", onPointerDown);
  }, [settingsOpen]);

  // Keep the AI panel's handle pointing at fresh closures every render; it is
  // only read on a user click, long after the core is wired
  useEffect(() => {
    studioHandle.current = {
      getCode: () => coreRef.current?.getCode() ?? "",
      loadCode: (code, params) =>
        coreRef.current?.loadCode(code, params) ??
        Promise.resolve<RunOutcome>({
          ok: false,
          error: "The Studio is not ready yet.",
        }),
      openGeneratedTab,
      getParams: () => coreRef.current?.getParams() ?? {},
      getTabId: () => tabsRef.current.activeId,
      capture: () => viewportRef.current?.capture() ?? Promise.resolve(null),
    };
  });

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
    // Every element the imperative wiring drives is always mounted (hidden, not
    // unmounted), so bind each once here and skip setup if any is missing
    const viewportEl = viewportMount.current;
    const paramsEl = paramsMount.current;
    const statusEl = statusRef.current;
    const editorEl = editorMount.current;
    const themeLabelEl = themeLabelRef.current;
    const themeBtnEl = themeBtnRef.current;
    const kernelEl = kernelRef.current;
    const exportEl = exportRef.current;
    // The restored workspace (shared with the useState seed above)
    const workspace = initialWorkspaceRef.current;
    if (
      !workspace ||
      !viewportEl ||
      !paramsEl ||
      !statusEl ||
      !editorEl ||
      !themeLabelEl ||
      !themeBtnEl ||
      !kernelEl ||
      !exportEl
    )
      return;
    inited.current = true;

    const store = new ParamStore();
    // Model code is evaluated in a sandbox worker (no DOM/token access); the
    // store here holds values + declarations for the parameter UI only
    const runner = new ModelRunner();
    // The theme is stamped on <html> at app boot (main.tsx initTheme). Read the
    // current value to seed the viewport and editor.
    const initialTheme = getTheme();

    const viewport = new Viewport(
      viewportEl,
      initialTheme,
      // Read the saved choice directly: this setup effect runs once
      loadRendererPreference(),
      setActiveRenderer,
    );
    viewportRef.current = viewport;
    viewport.onProjectionChange = setProjection;
    // Read the saved choices directly: this setup effect runs once
    viewport.setInvertDrag(loadInvertDrag());
    viewport.setRenderMode(loadRenderMode());
    viewport.onRenderModeChange = (mode) => {
      setRenderMode(mode);
      saveRenderMode(mode);
    };
    if (gizmoMount.current) viewport.mountGizmo(gizmoMount.current);
    // The B-rep kernel runs in its own worker (AsyncKernel); the mesh and Rust
    // kernels are fast enough to stay in-process
    const kernels: Record<string, Kernel | AsyncKernel> = { ts: meshKernel };
    let activeKernel: Kernel | AsyncKernel = meshKernel;
    let activeKernelKey = "ts";
    // Guards a second click while the on-demand B-rep wasm is still fetching
    let brepLoading = false;
    // Set when run() triggers an automatic switch to B-rep, so the first render
    // on the newly active kernel can explain why the kernel changed
    let announceAutoSwitch = false;
    let currentNode: OpNode | null = null;
    let paramsSignature = " ";
    // Whether the parameters panel is folded down to its title
    let paramsCollapsed = loadParamsCollapsed();

    // The model the editor opens with: the active tab's code.
    const initialDoc =
      workspace.tabs.find((t) => t.id === workspace.activeId)?.code ?? "";

    const renderParams = () => {
      const decls = store.list();
      const sig = store.signature();
      if (sig === paramsSignature) return;
      paramsSignature = sig;

      paramsEl.textContent = "";
      paramsEl.hidden = decls.length === 0;
      if (!decls.length) return;

      // The title doubles as a toggle that folds the sliders away, so the
      // panel can get out of the model's way; the choice persists per browser
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "params-title params-toggle";
      toggle.setAttribute("aria-controls", "params-body");
      toggle.innerHTML =
        '<svg class="params-chevron" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      const label = document.createElement("span");
      label.textContent = "Parameters";
      const count = document.createElement("span");
      count.className = "params-count";
      count.textContent = String(decls.length);
      toggle.append(label, count);
      const body = document.createElement("div");
      body.className = "params-body";
      body.id = "params-body";
      const applyCollapsed = () => {
        body.hidden = paramsCollapsed;
        toggle.setAttribute("aria-expanded", String(!paramsCollapsed));
        toggle.title = paramsCollapsed ? "Show parameters" : "Hide parameters";
        paramsEl.toggleAttribute("data-collapsed", paramsCollapsed);
      };
      toggle.addEventListener("click", () => {
        paramsCollapsed = !paramsCollapsed;
        saveParamsCollapsed(paramsCollapsed);
        applyCollapsed();
      });
      paramsEl.append(toggle, body);
      applyCollapsed();

      for (const d of decls) {
        const row = document.createElement("label");
        row.className = "param-row";
        const name = document.createElement("span");
        name.className = "param-name";
        name.textContent = d.name;

        if (d.kind === "number") {
          // The value reads like a label but is an editable field: click (or
          // Tab to) it and type an exact value, which the slider can't hit
          const value = document.createElement("span");
          value.className = "param-value";
          const field = document.createElement("input");
          field.type = "text";
          field.inputMode = "decimal";
          field.className = "param-value-input";
          field.spellcheck = false;
          field.autocomplete = "off";
          field.setAttribute(
            "aria-label",
            d.unit ? `${d.name} in ${d.unit}` : d.name,
          );
          field.title =
            "Type an exact value (math like 50/2 works). Enter applies, Esc cancels, arrow keys step";
          value.appendChild(field);
          if (d.unit) {
            const unit = document.createElement("span");
            unit.className = "param-unit";
            // A degree sign sits flush against its number
            if (d.unit === "°") unit.classList.add("flush");
            unit.textContent = d.unit;
            value.appendChild(unit);
          }

          const input = document.createElement("input");
          input.type = "range";
          input.min = String(d.min);
          input.max = String(d.max);
          input.step = String(d.step);
          input.value = String(d.value);
          input.setAttribute("aria-label", d.name);

          let current = d.value;
          const show = (v: number) => {
            field.value = formatParamNumber(v);
            sizeField();
          };
          const sizeField = () =>
            field.style.setProperty(
              "--chars",
              String(Math.max(2, field.value.length)),
            );
          const apply = (v: number) => {
            current = v;
            store.set(d.name, v);
            input.value = String(v);
            show(v);
            scheduleLive();
          };
          const commit = () => {
            const typed = parseParamInput(field.value, d);
            if (!typed.ok) {
              // Flag the entry briefly, then put the last good value back
              field.setAttribute("aria-invalid", "true");
              show(current);
              window.setTimeout(
                () => field.removeAttribute("aria-invalid"),
                1200,
              );
              return;
            }
            field.removeAttribute("aria-invalid");
            if (typed.value !== current) apply(typed.value);
            else show(current);
          };
          show(current);

          // While dragging, rebuild a fast draft each frame; the release
          // ("change") rebuilds the exact part
          input.addEventListener("input", () => {
            current = Number(input.value);
            store.set(d.name, current);
            show(current);
            scheduleLive(true);
          });
          input.addEventListener("change", () => scheduleLive());

          field.addEventListener("focus", () => field.select());
          field.addEventListener("input", sizeField);
          field.addEventListener("blur", commit);
          field.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
              field.select();
            } else if (e.key === "Escape") {
              e.preventDefault();
              field.removeAttribute("aria-invalid");
              show(current);
              field.select();
            } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
              // Step like the slider, ten steps with Shift
              e.preventDefault();
              const delta =
                (e.key === "ArrowUp" ? 1 : -1) * d.step * (e.shiftKey ? 10 : 1);
              const next = Math.min(Math.max(current + delta, d.min), d.max);
              if (next !== current) apply(Number(next.toPrecision(10)));
              field.select();
            }
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

        body.appendChild(row);
      }
    };

    // Each run is tagged so a newer run's result supersedes an older one still
    // in flight in the worker (rapid slider drags or edits)
    let runSeq = 0;
    // The run whose mesh is on screen. A drag starts a run every frame, so by
    // the time a slow rebuild lands a newer run always exists; showing any mesh
    // newer than the current one keeps the part moving under the slider
    let shownSeq = 0;
    // A superseded run hands its waiters to the run that replaced it, so a
    // debounced or live re-run can never strand the generation repair loop
    const waiters = createRunWaiters<RunOutcome>();
    const run = (
      reframe = false,
      onResult?: (outcome: RunOutcome) => void,
      preview = false,
    ) => {
      waiters.add(onResult);
      const t0 = performance.now();
      const seq = ++runSeq;
      // Evaluate the model in the sandbox worker, mesh it (the B-rep kernel in
      // its own worker), then render on the main thread
      void runner
        .build(editor.getValue(), store.valuesSnapshot())
        .then(async (result) => {
          if (seq !== runSeq) return; // a newer run has superseded this one
          if (!result.ok) {
            currentNode = null;
            statusEl.className = "status err";
            statusEl.textContent = `✗ ${result.error}`;
            waiters.settle({ ok: false, error: result.error });
            return;
          }
          store.adoptRun(result.decls);
          const node = result.node;

          // Fillet/chamfer/shell exist only on the B-rep (OCCT) kernel, so load
          // and switch to it on demand. activateBrepKernel flips activeKernelKey
          // to "brep" before it re-runs, so this cannot re-trigger itself. Any
          // waiters stay queued and see the outcome of the post-switch run
          if (shouldAutoSwitchToBrep(node, activeKernelKey)) {
            announceAutoSwitch = true;
            activateBrepKernel(reframe);
            return;
          }

          try {
            // Colored models evaluate part by part (see colors.ts)
            const mesh = await evaluateColored(activeKernel, node, { preview });
            if (seq < shownSeq) return; // a newer mesh is already showing
            shownSeq = seq;
            viewport.setMesh(mesh, reframe);
            currentNode = node;
            renderParams();
            const need = brepNeed(node);
            if (announceAutoSwitch && need) {
              // First successful render of a B-rep model after an automatic
              // switch: say what in this model needed it, then fall back to the
              // usual stats. Gate on the need so a failed first eval cannot
              // mislabel a later non-B-rep render with the switch notice
              announceAutoSwitch = false;
              statusEl.className = "status ok";
              statusEl.textContent = `✓ Using the B-rep kernel for ${BREP_NEED_LABELS[need]}`;
            } else {
              const ms = (performance.now() - t0).toFixed(0);
              statusEl.className = "status ok";
              statusEl.textContent = `✓ ${mesh.triangleCount.toLocaleString()} triangles · ${ms} ms · ${activeKernel.name}`;
            }
            // Only the newest run reports an outcome; waiters ride along to it
            if (seq === runSeq) waiters.settle({ ok: true });
          } catch (err) {
            // A newer run owns the status (this also covers an evaluation the
            // B-rep worker dropped as superseded mid-drag)
            if (seq !== runSeq) return;
            currentNode = null;
            const message = err instanceof Error ? err.message : String(err);
            statusEl.className = "status err";
            statusEl.textContent = `✗ ${message}`;
            waiters.settle({ ok: false, error: message });
          }
        });
    };

    // Editor edits re-eval arbitrary code, so debounce them while typing.
    let timer: number | undefined;
    const scheduleRun = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => run(), 200);
    };

    // Param changes only change a value on an already-valid model, so run
    // live, coalesced to one recompute per animation frame for instant feedback
    // without reframing the camera. A slider drag asks for a draft (`preview`)
    // the kernel can build fast; any exact request in the same frame wins
    let liveRaf: number | undefined;
    let liveExact = false;
    const scheduleLive = (preview = false) => {
      if (!preview) liveExact = true;
      if (liveRaf !== undefined) return;
      liveRaf = requestAnimationFrame(() => {
        liveRaf = undefined;
        const exact = liveExact;
        liveExact = false;
        run(false, undefined, !exact);
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

    editor = createEditor(editorEl, {
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
      themeLabelEl.textContent = next === "dark" ? "Dark" : "Light";
    };
    syncThemeLabel(initialTheme);

    const unsubscribeTheme = subscribe((next) => {
      editor.setTheme(next);
      viewport.setTheme(next);
      syncThemeLabel(next);
    });

    themeBtnEl.addEventListener("click", toggleTheme);

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
    const activateBrepKernel = (reframe = false) => {
      if (kernelRef.current) kernelRef.current.value = "brep";
      if (kernels.brep) {
        activeKernel = kernels.brep;
        activeKernelKey = "brep";
        run(reframe);
        saveSoon();
        return;
      }
      // A fetch already in flight re-runs when it lands, which settles any
      // queued waiters
      if (brepLoading) return;
      brepLoading = true;
      statusEl.className = "status";
      statusEl.textContent = "Loading B-rep kernel…";
      loadBrepWorkerKernel().then((brep) => {
        brepLoading = false;
        if (!brep) {
          // Keep running on the kernel that was active before the switch
          announceAutoSwitch = false;
          const message = "The B-rep kernel could not be loaded.";
          statusEl.className = "status err";
          statusEl.textContent = `✗ ${message}`;
          if (kernelRef.current) kernelRef.current.value = activeKernelKey;
          waiters.settle({ ok: false, error: message });
          return;
        }
        // Cache it regardless, but only activate if the dropdown has not been
        // switched away while the wasm was loading
        kernels.brep = brep;
        if (kernelRef.current?.value !== "brep") {
          waiters.settle({
            ok: false,
            error: "The kernel was switched before the model could render.",
          });
          return;
        }
        activeKernel = brep;
        activeKernelKey = "brep";
        run(reframe);
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

    kernelEl.addEventListener("change", () => {
      selectKernel(kernelEl.value);
    });

    exportEl.addEventListener("click", async () => {
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
        const data = await exportColored(activeKernel, currentNode, format);
        const blob = new Blob([data.buffer as ArrayBuffer], { type: mime });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        // Name the file after the active model (tab), e.g. "Hex Nut.step"
        a.download = exportFileName(
          activeTab(tabsRef.current)?.name ?? "model",
          format,
        );
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
      loadCode: (code, params) =>
        new Promise<RunOutcome>((resolve) => {
          if (params) {
            store.seed(params);
            // Rebuild the controls so the sliders show the new values
            paramsSignature = " ";
          }
          editor.setValue(code);
          setCurrentExample(matchExample(code) ?? CUSTOM_OPTION);
          run(true, resolve);
        }),
      getParams: () =>
        Object.fromEntries(store.list().map((d) => [d.name, d.value])),
      save: saveSoon,
    };

    run(true);

    // Restore a saved B-rep selection by driving the same on-demand load path
    if (workspace.kernel === "brep" && kernelRef.current) {
      kernelRef.current.value = "brep";
      selectKernel("brep");
    }

    // The setup effect runs once (guarded by inited) and owns the viewport,
    // editor, and model worker for the Studio's lifetime; like them, the worker
    // is intentionally not disposed here. Tearing it down in this cleanup would
    // kill an in-flight async build during React's StrictMode remount, which the
    // guarded second mount would not recreate.
    return () => unsubscribeTheme();
  }, []);

  // Offer the viewport's camera actions to the app-wide command palette while
  // the Studio is open. Declared after the setup effect, so the viewport exists
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    return registerViewControl({
      setView: (view) => viewport.setView(view),
      flipView: () => viewport.flipView(),
      frameModel: () => viewport.frameModel(),
      toggleProjection: () => viewport.toggleProjection(),
      setRenderMode: (mode) => viewport.setRenderMode(mode),
    });
  }, []);

  const RenderModeIcon = RENDER_MODE_ICONS[renderMode];

  // Keep the retained name current while the confirm dialog is open
  if (closing) closingNameRef.current = closing.name;

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
          <span className="brand-badge">Early access</span>
        </span>
        <span className="tag">code CAD · write code, get geometry</span>
        <div className="header-controls">
          <GeneratePanel handle={studioHandle} chatMount={chatMount} />
          <ImportArtButton handle={studioHandle} />
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
          <button
            ref={exportRef}
            type="button"
            className="primary"
            title="Download the model"
          >
            Export
          </button>
          {/* Preferences (kernel, theme, export format) live here so they stay
              out of the primary action row. The controls are always mounted
              (the panel is hidden, not unmounted) so the Studio's imperative
              wiring keeps its refs */}
          <div className="settings-menu" ref={settingsRef}>
            <button
              type="button"
              className="icon-btn settings-trigger"
              onClick={() => setSettingsOpen((open) => !open)}
              aria-haspopup="menu"
              aria-expanded={settingsOpen}
              aria-label="Settings"
              title="Settings"
            >
              <svg
                viewBox="0 0 24 24"
                width="16"
                height="16"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                role="img"
                aria-label="Settings"
              >
                <title>Settings</title>
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </button>
            <div
              className="settings-dropdown"
              role="menu"
              hidden={!settingsOpen}
            >
              <label className="settings-row">
                <span className="settings-label">Kernel</span>
                <NativeSelect ref={kernelRef} defaultValue="ts" size="sm">
                  <option value="ts">TS (mesh)</option>
                  <option value="brep">B-rep (OCCT)</option>
                </NativeSelect>
              </label>
              <div
                className="settings-row"
                title="Model sizes and exported files"
              >
                <span className="settings-label">Units</span>
                <span className="settings-value">Millimeters</span>
              </div>
              <label className="settings-row">
                <span className="settings-label">Renderer</span>
                <NativeSelect
                  size="sm"
                  value={rendererPref}
                  onChange={(e) => {
                    const next = parseRendererPreference(e.target.value);
                    setRendererPref(next);
                    saveRendererPreference(next);
                    viewportRef.current?.setRendererPreference(next);
                  }}
                >
                  <option value="auto">Auto</option>
                  <option value="webgpu">WebGPU</option>
                  <option value="webgl">WebGL</option>
                </NativeSelect>
              </label>
              <label
                className="settings-row"
                title="Which way dragging the 3D view (or the axis gizmo) turns it"
              >
                <span className="settings-label">Orbit drag</span>
                <NativeSelect
                  size="sm"
                  value={invertDrag ? "inverted" : "standard"}
                  onChange={(e) => {
                    const next = e.target.value === "inverted";
                    setInvertDrag(next);
                    saveInvertDrag(next);
                    viewportRef.current?.setInvertDrag(next);
                  }}
                >
                  <option value="standard">Standard</option>
                  <option value="inverted">Inverted</option>
                </NativeSelect>
              </label>
              <label className="settings-row">
                <span className="settings-label">Export format</span>
                <NativeSelect ref={formatRef} defaultValue="stl" size="sm">
                  <option value="stl">STL</option>
                  <option value="3mf">3MF</option>
                  <option value="step">STEP</option>
                </NativeSelect>
              </label>
              <button
                ref={themeBtnRef}
                type="button"
                className="settings-row settings-row-btn"
                title="Toggle light/dark"
              >
                <span className="settings-label">
                  Theme: <span ref={themeLabelRef}>Theme</span>
                </span>
                <kbd className="kbd">T</kbd>
              </button>
            </div>
          </div>
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

      <main className="facet-main" data-mobile-view={mobileView} ref={mainRef}>
        <section className="editor-pane">
          <div className="code" ref={editorMount} />
          <div className="status" ref={statusRef} />
          <PaneSplitter container={mainRef} />
        </section>
        <section className="viewport">
          <div className="viewport-canvas" ref={viewportMount} />
          <div className="chat-dock" ref={setChatMount} />
          <div className="view-nav">
            <div className="view-nav-gizmo" ref={gizmoMount} />
            <div className="view-nav-buttons">
              <ViewNavButton
                label={
                  projection === "orthographic"
                    ? "Switch to perspective"
                    : "Switch to orthographic"
                }
                shortcut={VIEW_KEYS.projection}
                pressed={projection === "orthographic"}
                onClick={() => viewportRef.current?.toggleProjection()}
              >
                {projection === "orthographic" ? (
                  <Square size={15} />
                ) : (
                  <Box size={15} />
                )}
              </ViewNavButton>
              <ViewNavButton
                label="Fit the model in view"
                shortcut={VIEW_KEYS.frame}
                onClick={() => viewportRef.current?.frameModel()}
              >
                <Focus size={15} />
              </ViewNavButton>
              <ViewNavButton
                label="Reset to the home view"
                shortcut={VIEW_KEYS.home}
                onClick={() => viewportRef.current?.setView("home")}
              >
                <House size={15} />
              </ViewNavButton>
              <ViewNavButton
                label={`Display: ${RENDER_MODE_LABELS[renderMode]}. Switch to ${RENDER_MODE_LABELS[nextRenderMode(renderMode)].toLowerCase()}`}
                shortcut={VIEW_KEYS.renderMode}
                onClick={() => viewportRef.current?.cycleRenderMode()}
              >
                <RenderModeIcon size={15} />
              </ViewNavButton>
            </div>
          </div>
          {activeRenderer && (
            <div
              className="viewport-renderer"
              data-renderer={activeRenderer}
              title={
                activeRenderer === "webgpu"
                  ? "Rendering with WebGPU"
                  : "Rendering with WebGL, the compatibility renderer for browsers without working WebGPU. Change it in Settings"
              }
            >
              {rendererLabel(activeRenderer)}
            </div>
          )}
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

      <ConfirmDialog
        open={closing !== null}
        onOpenChange={(open) => {
          if (!open) setClosing(null);
        }}
        title={`Close “${closingNameRef.current}”?`}
        description="This model will be removed from your workspace and cannot be recovered."
        confirmLabel="Close model"
        cancelLabel="Cancel"
        destructive
        onConfirm={() => {
          if (closing) doCloseTab(closing.id);
        }}
      />
    </div>
  );
}
