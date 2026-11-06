/**
 * Save and open Facet model source as files.
 *
 * Models are saved as `.facet.ts`: real TypeScript (so an editor gives full
 * highlighting and the Facet API types resolve), with the `.facet` segment
 * namespacing it as a Facet model for file association and the open picker.
 *
 * Progressive by capability, so it works in the browser and inside the desktop
 * (Tauri) webview without any native plugin: the File System Access API is used
 * when present (a real save/open dialog, Chromium web), otherwise it falls back
 * to a download for save and a hidden file input for open, which every webview
 * supports. A native Tauri dialog/fs path can be layered on later for a nicer
 * desktop experience without changing callers.
 */

const FACET_EXT = ".facet.ts";

/** Characters a filesystem will not accept in a name, stripped for the save name. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: control chars are exactly what we strip from a file name
const UNSAFE = /[/\\:*?"<>|\u0000-\u001f]/g;

/**
 * Build a suggested file name from a model (tab) name. Keeps the human name
 * (spaces and case) but strips path-unsafe characters, and ensures a single
 * `.facet.ts` suffix. Falls back to "model" when the name is empty.
 */
export const suggestedFileName = (modelName: string): string => {
  const base = stripFacetExt(modelName).replace(UNSAFE, "").trim();
  return `${base || "model"}${FACET_EXT}`;
};

/**
 * Derive a tab name from a file name: drop a `.facet.ts` (or plain `.ts`)
 * suffix so an opened `hex-nut.facet.ts` becomes the tab "hex-nut".
 */
export const modelNameFromFile = (fileName: string): string =>
  stripFacetExt(fileName).trim() || "model";

const stripFacetExt = (name: string): string => {
  if (name.endsWith(FACET_EXT)) return name.slice(0, -FACET_EXT.length);
  if (name.endsWith(".ts")) return name.slice(0, -".ts".length);
  return name;
};

interface SaveFilePickerWindow {
  showSaveFilePicker?: (opts: unknown) => Promise<{
    createWritable: () => Promise<{
      write: (data: string) => Promise<void>;
      close: () => Promise<void>;
    }>;
  }>;
  showOpenFilePicker?: (
    opts: unknown,
  ) => Promise<Array<{ getFile: () => Promise<File> }>>;
}

const isAbort = (err: unknown): boolean =>
  err instanceof DOMException && err.name === "AbortError";

const pickerTypes = [
  {
    description: "Facet model",
    accept: { "text/plain": [FACET_EXT, ".ts"] },
  },
];

/**
 * Save model source to a file. Resolves true when written, false when the user
 * cancelled. Uses the File System Access API when available, else downloads.
 */
export const saveModelToFile = async (
  modelName: string,
  code: string,
): Promise<boolean> => {
  const fileName = suggestedFileName(modelName);
  const w = window as unknown as SaveFilePickerWindow;

  if (typeof w.showSaveFilePicker === "function") {
    try {
      const handle = await w.showSaveFilePicker({
        suggestedName: fileName,
        types: pickerTypes,
      });
      const writable = await handle.createWritable();
      await writable.write(code);
      await writable.close();
      return true;
    } catch (err) {
      if (isAbort(err)) return false;
      // Any other failure (unsupported, permission): fall back to a download
    }
  }

  const blob = new Blob([code], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  return true;
};

/**
 * Open a model source file. Resolves the file's name and contents, or null when
 * the user cancelled. Uses the File System Access API when available, else a
 * hidden file input.
 */
export const openModelFromFile = async (): Promise<{
  name: string;
  code: string;
} | null> => {
  const w = window as unknown as SaveFilePickerWindow;

  if (typeof w.showOpenFilePicker === "function") {
    try {
      const [handle] = await w.showOpenFilePicker({
        types: pickerTypes,
        multiple: false,
      });
      if (!handle) return null;
      const file = await handle.getFile();
      return { name: modelNameFromFile(file.name), code: await file.text() };
    } catch (err) {
      if (isAbort(err)) return null;
      // Fall back to a file input on any other failure
    }
  }

  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = `${FACET_EXT},.ts,text/plain`;
    input.style.display = "none";
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      input.remove();
      if (!file) {
        resolve(null);
        return;
      }
      resolve({ name: modelNameFromFile(file.name), code: await file.text() });
    });
    document.body.appendChild(input);
    input.click();
  });
};
