import { describe, expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import GenerationQueue from "./GenerationQueue";

import type { GenerationJob } from "@/ai/jobs";

const noop = () => {};

const render = (
  jobs: GenerationJob[],
  extra: Partial<Parameters<typeof GenerationQueue>[0]> = {},
) =>
  renderToStaticMarkup(
    <GenerationQueue
      jobs={jobs}
      disabled={false}
      openingId={null}
      spentNotes={{}}
      failureLinks={() => ({ buyCredits: null, upgrade: null })}
      onOpen={noop}
      onDiscard={noop}
      onRetry={noop}
      onDismiss={noop}
      {...extra}
    />,
  );

/** The visible text of a rendered fragment, tags stripped */
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** The labels of every button, in order */
const buttons = (html: string) =>
  [...html.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((m) => m[1]);

describe("GenerationQueue", () => {
  test("renders nothing without jobs", () => {
    expect(render([])).toBe("");
  });

  test("shows each state with its next step", () => {
    const html = render([
      { id: "q", status: "queued", prompt: "a cube" },
      { id: "r", status: "running", prompt: "a nut" },
      { id: "s", status: "succeeded", prompt: "a brick", code: "x" },
      {
        id: "f",
        status: "failed",
        prompt: "a gear",
        error: { message: "Could not generate valid code." },
      },
    ]);

    expect(text(html)).toContain("a cube Queued");
    expect(text(html)).toContain("a nut Generating");
    expect(text(html)).toContain("a brick Ready");
    expect(text(html)).toContain("a gear Failed");
    expect(text(html)).toContain("Could not generate valid code.");
    // queued: cancel; running: none; ready: open + discard; failed: retry + dismiss
    expect(buttons(html)).toEqual([
      "Cancel",
      "Open",
      "Discard",
      "Try again",
      "Dismiss",
    ]);
  });

  test("says leaving is safe while anything is generating, not after", () => {
    const hint = "Generating in the background";
    expect(render([{ id: "r", status: "running", prompt: "p" }])).toContain(
      hint,
    );
    expect(
      render([{ id: "s", status: "succeeded", prompt: "p", code: "x" }]),
    ).not.toContain(hint);
  });

  test("a failed part offers the billing links its reason calls for, and its spend", () => {
    const html = render(
      [
        {
          id: "f",
          status: "failed",
          prompt: "p",
          error: { message: "Out of credits.", code: "out_of_credits" },
        },
      ],
      {
        failureLinks: () => ({
          buyCredits: "https://account.test/billing",
          upgrade: null,
        }),
        spentNotes: { f: "2 credits spent." },
      },
    );

    expect(html).toContain('href="https://account.test/billing"');
    expect(text(html)).toContain("Buy credits");
    expect(text(html)).not.toContain("Upgrade to Pro");
    expect(text(html)).toContain("2 credits spent.");
  });

  test("disables every action while a part is opening", () => {
    const html = render(
      [{ id: "s", status: "succeeded", prompt: "p", code: "x" }],
      { disabled: true, openingId: "s" },
    );
    expect(html.match(/disabled=""/g)).toHaveLength(2);
    expect(html).toContain('aria-busy="true"');
  });
});
