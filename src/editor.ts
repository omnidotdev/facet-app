import { indentWithTab } from "@codemirror/commands";
import { javascript } from "@codemirror/lang-javascript";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import { basicSetup, EditorView } from "codemirror";
import type { Theme } from "./theme";

// basicSetup wires line numbers, history, bracket matching, autocomplete, and
// the default keymap - which binds Mod-/ to toggle line comments, so ctrl+/
// (cmd+/ on macOS) comments and uncomments.

const MONO = 'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, monospace';

const darkTheme = EditorView.theme(
  {
    "&": { color: "#d7e6f5", backgroundColor: "#122a43", height: "100%", fontSize: "13px" },
    ".cm-scroller": { fontFamily: MONO, lineHeight: "1.55" },
    ".cm-content": { caretColor: "#dd6e33" },
    "&.cm-focused .cm-cursor": { borderLeftColor: "#dd6e33" },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
      backgroundColor: "rgba(221, 110, 51, 0.28)",
    },
    ".cm-activeLine": { backgroundColor: "rgba(255, 255, 255, 0.04)" },
    ".cm-gutters": { backgroundColor: "#0f2438", color: "#4d6683", border: "none" },
    ".cm-activeLineGutter": { backgroundColor: "rgba(255, 255, 255, 0.04)", color: "#8fb0cf" },
    ".cm-matchingBracket, &.cm-focused .cm-matchingBracket": {
      backgroundColor: "rgba(221, 110, 51, 0.25)",
      outline: "1px solid rgba(221, 110, 51, 0.5)",
    },
  },
  { dark: true },
);

const darkHighlight = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.moduleKeyword], color: "#e2864a", fontWeight: "600" },
  { tag: [t.string, t.special(t.string)], color: "#7fd6a3" },
  { tag: [t.number, t.bool, t.null], color: "#e0b070" },
  { tag: [t.comment, t.lineComment, t.blockComment], color: "#5f7690", fontStyle: "italic" },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: "#9dc6f0" },
  { tag: [t.variableName, t.propertyName], color: "#cfe0f0" },
  { tag: [t.definition(t.variableName)], color: "#9dc6f0" },
  { tag: [t.operator, t.punctuation, t.separator], color: "#a9c2d8" },
  { tag: [t.typeName, t.className], color: "#7fd6a3" },
]);

const lightTheme = EditorView.theme(
  {
    "&": { color: "#1c3450", backgroundColor: "#e7e2d8", height: "100%", fontSize: "13px" },
    ".cm-scroller": { fontFamily: MONO, lineHeight: "1.55" },
    ".cm-content": { caretColor: "#c8611f" },
    "&.cm-focused .cm-cursor": { borderLeftColor: "#c8611f" },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
      backgroundColor: "rgba(200, 97, 31, 0.22)",
    },
    ".cm-activeLine": { backgroundColor: "rgba(18, 42, 67, 0.05)" },
    ".cm-gutters": { backgroundColor: "#ded6c6", color: "#8a7d64", border: "none" },
    ".cm-activeLineGutter": { backgroundColor: "rgba(18, 42, 67, 0.06)", color: "#5a4f3c" },
    ".cm-matchingBracket, &.cm-focused .cm-matchingBracket": {
      backgroundColor: "rgba(200, 97, 31, 0.2)",
      outline: "1px solid rgba(200, 97, 31, 0.5)",
    },
  },
  { dark: false },
);

const lightHighlight = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.moduleKeyword], color: "#b4560f", fontWeight: "600" },
  { tag: [t.string, t.special(t.string)], color: "#2f7d4f" },
  { tag: [t.number, t.bool, t.null], color: "#9a6b12" },
  { tag: [t.comment, t.lineComment, t.blockComment], color: "#8a7d64", fontStyle: "italic" },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: "#2762a8" },
  { tag: [t.variableName, t.propertyName], color: "#33475a" },
  { tag: [t.definition(t.variableName)], color: "#2762a8" },
  { tag: [t.operator, t.punctuation, t.separator], color: "#5f6f80" },
  { tag: [t.typeName, t.className], color: "#2f7d4f" },
]);

function themeExtension(theme: Theme): Extension {
  return theme === "light"
    ? [lightTheme, syntaxHighlighting(lightHighlight)]
    : [darkTheme, syntaxHighlighting(darkHighlight)];
}

export interface FacetEditor {
  getValue(): string;
  setValue(text: string): void;
  setTheme(theme: Theme): void;
  focus(): void;
}

/** Mount a Facet-themed code editor and return handles to read/replace/theme it. */
export function createEditor(
  parent: HTMLElement,
  opts: { doc: string; onChange: () => void; theme: Theme },
): FacetEditor {
  const themeCompartment = new Compartment();
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: opts.doc,
      extensions: [
        basicSetup,
        javascript(),
        themeCompartment.of(themeExtension(opts.theme)),
        keymap.of([indentWithTab]),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) opts.onChange();
        }),
      ],
    }),
  });

  return {
    getValue: () => view.state.doc.toString(),
    setValue: (text: string) => {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
    },
    setTheme: (theme: Theme) => {
      view.dispatch({ effects: themeCompartment.reconfigure(themeExtension(theme)) });
    },
    focus: () => view.focus(),
  };
}
