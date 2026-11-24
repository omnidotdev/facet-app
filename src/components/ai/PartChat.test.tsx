import { describe, expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import PartChat from "./PartChat";

import type { ChatMessage } from "./PartChat";

const noop = () => {};

const render = (messages: ChatMessage[], busy = false) =>
  renderToStaticMarkup(
    <PartChat
      messages={messages}
      busy={busy}
      onSend={noop}
      onUndo={noop}
      onClear={noop}
    />,
  );

/** How many Undo buttons a render offers */
const undos = (html: string) => html.match(/>Undo</g)?.length ?? 0;

describe("PartChat", () => {
  test("starts as just the input", () => {
    const html = render([]);
    expect(html).toContain("Ask for a change");
    expect(html).not.toContain("part-chat-thread");
    expect(html).not.toContain("Clear the conversation");
  });

  test("shows the conversation, with a pending reply as working", () => {
    const html = render(
      [
        { id: "1", role: "user", text: "make the ring thicker" },
        { id: "2", role: "assistant", text: "", status: "pending" },
      ],
      true,
    );
    expect(html).toContain("make the ring thicker");
    expect(html).toContain("Changing the part");
    expect(html).toContain("Clear the conversation");
  });

  test("offers Undo only on the newest change that landed", () => {
    const html = render([
      { id: "1", role: "user", text: "make it taller" },
      { id: "2", role: "assistant", text: "Changed the part.", status: "done" },
      { id: "3", role: "user", text: "round the edges" },
      { id: "4", role: "assistant", text: "Changed the part.", status: "done" },
      { id: "5", role: "user", text: "add a hole" },
      { id: "6", role: "assistant", text: "Failed.", status: "failed" },
    ]);
    expect(undos(html)).toBe(1);
    // the Undo sits with the second change, before the failed request
    expect(html.indexOf(">Undo<")).toBeLessThan(html.indexOf("add a hole"));
    expect(html.indexOf(">Undo<")).toBeGreaterThan(
      html.indexOf("round the edges"),
    );
  });

  test("shows a reply's note, such as what it spent", () => {
    const html = render([
      { id: "1", role: "user", text: "make it taller" },
      {
        id: "2",
        role: "assistant",
        text: "Changed the part.",
        status: "done",
        note: "3 credits spent.",
      },
    ]);
    expect(html).toContain("3 credits spent.");
  });
});
