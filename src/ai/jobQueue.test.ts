import { describe, expect, test } from "bun:test";

import {
  QUEUE_COPY,
  discardConfirm,
  finishedJobs,
  finishedToast,
  hasActiveJobs,
  jobLabel,
  pollDelay,
  queueIndicator,
  withoutDismissed,
} from "./jobQueue";

import type { GenerationJob, JobStatus } from "./jobs";

const job = (
  id: string,
  status: JobStatus,
  extra: Partial<GenerationJob> = {},
): GenerationJob => ({ id, status, prompt: `prompt ${id}`, ...extra });

describe("jobLabel", () => {
  test("names every state in plain words", () => {
    expect(jobLabel("queued")).toBe("Queued");
    expect(jobLabel("running")).toBe("Generating");
    expect(jobLabel("succeeded")).toBe("Ready");
    expect(jobLabel("failed")).toBe("Failed");
  });
});

describe("hasActiveJobs", () => {
  test("is true while any job is queued or generating", () => {
    expect(hasActiveJobs([job("a", "succeeded"), job("b", "queued")])).toBe(
      true,
    );
    expect(hasActiveJobs([job("a", "running")])).toBe(true);
    expect(hasActiveJobs([job("a", "succeeded"), job("b", "failed")])).toBe(
      false,
    );
    expect(hasActiveJobs([])).toBe(false);
  });
});

describe("pollDelay", () => {
  test("starts quick and backs off to a ceiling", () => {
    expect(pollDelay(0)).toBe(2_000);
    expect(pollDelay(1)).toBe(3_000);
    expect(pollDelay(2)).toBe(4_500);
    expect(pollDelay(10)).toBe(10_000);
  });
});

describe("finishedJobs", () => {
  test("reports only jobs that were active before and are done now", () => {
    const before = [
      job("a", "running"),
      job("b", "queued"),
      job("c", "succeeded"),
    ];
    const after = [
      job("a", "succeeded", { code: "x" }),
      job("b", "running"),
      job("c", "succeeded", { code: "y" }),
      job("d", "failed"),
    ];

    expect(finishedJobs(before, after).map((j) => j.id)).toEqual(["a"]);
  });

  test("a first load reports nothing, so a reload never toasts old results", () => {
    expect(finishedJobs([], [job("a", "succeeded", { code: "x" })])).toEqual(
      [],
    );
  });
});

describe("queueIndicator", () => {
  test("counts what is generating and what is ready to open", () => {
    expect(
      queueIndicator([
        job("a", "running"),
        job("b", "queued"),
        job("c", "succeeded", { code: "x" }),
        job("d", "failed"),
      ]),
    ).toEqual({
      active: 2,
      ready: 1,
      label: "2 generating, 1 ready",
    });
  });

  test("is null when nothing is generating or ready", () => {
    expect(queueIndicator([job("d", "failed")])).toBeNull();
    expect(queueIndicator([])).toBeNull();
  });

  test("labels a single state on its own", () => {
    expect(queueIndicator([job("a", "running")])?.label).toBe("1 generating");
    expect(queueIndicator([job("a", "succeeded", { code: "x" })])?.label).toBe(
      "1 ready",
    );
  });
});

describe("finishedToast", () => {
  test("announces a ready part, pointing at where to open it", () => {
    expect(finishedToast([job("a", "succeeded", { code: "x" })])).toBe(
      "Your part is ready. Open Describe a part to view it.",
    );
    expect(
      finishedToast([
        job("a", "succeeded", { code: "x" }),
        job("b", "succeeded", { code: "y" }),
      ]),
    ).toBe("2 parts are ready. Open Describe a part to view them.");
  });

  test("announces a failure when nothing finished well", () => {
    expect(finishedToast([job("a", "failed")])).toBe(
      "A generation failed. Open Describe a part for details.",
    );
  });

  test("prefers the ready news when both happened", () => {
    expect(
      finishedToast([job("a", "failed"), job("b", "succeeded", { code: "x" })]),
    ).toBe("Your part is ready. Open Describe a part to view it.");
  });

  test("says nothing when nothing finished", () => {
    expect(finishedToast([])).toBeNull();
  });
});

describe("withoutDismissed", () => {
  test("drops jobs the user dismissed while a list read was in flight", () => {
    expect(
      withoutDismissed(
        [job("a", "succeeded"), job("b", "queued")],
        new Set(["a"]),
      ).map((j) => j.id),
    ).toEqual(["b"]);
  });
});

describe("discardConfirm", () => {
  test("names the ready part and says the deletion cannot be undone", () => {
    expect(discardConfirm({ status: "succeeded" }, "hex nut")).toEqual({
      title: "Discard “hex nut”?",
      description:
        "The generated part will be deleted and cannot be recovered.",
      confirmLabel: "Discard part",
    });
  });

  test("a queued generation is cancelled, also irreversibly", () => {
    const copy = discardConfirm({ status: "queued" }, "hex nut");
    expect(copy.title).toBe("Cancel “hex nut”?");
    expect(copy.description).toContain("cannot be undone");
  });
});

describe("QUEUE_COPY", () => {
  test("never exposes internal vocabulary", () => {
    const text = Object.values(QUEUE_COPY).join(" ").toLowerCase();
    for (const word of ["job", "worker", "queue id", "synapse", "server"]) {
      expect(text).not.toContain(word);
    }
  });
});
