import { describe, expect, test } from "bun:test";

import { createRunWaiters } from "@/runWaiters";

describe("createRunWaiters", () => {
  test("settles every queued waiter once with the final outcome", () => {
    const waiters = createRunWaiters<string>();
    const seen: string[] = [];
    // A run that gets superseded leaves its waiter queued for the next one
    waiters.add((o) => seen.push(`first:${o}`));
    waiters.add((o) => seen.push(`second:${o}`));
    waiters.settle("ok");
    expect(seen).toEqual(["first:ok", "second:ok"]);

    waiters.settle("again");
    expect(seen).toHaveLength(2);
  });

  test("ignores a run without a waiter", () => {
    const waiters = createRunWaiters<string>();
    waiters.add(undefined);
    expect(() => waiters.settle("ok")).not.toThrow();
  });
});
