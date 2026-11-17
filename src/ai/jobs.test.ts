import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { GenerateError } from "./generate";
import {
  dismissGeneration,
  enqueueGeneration,
  listGenerations,
  parseJob,
} from "./jobs";

const API_URL = "https://facet-api.test";
const TOKEN = "omni-access-token";
const managed = { getAccessToken: async () => TOKEN };

interface FetchCall {
  url: string;
  init: RequestInit;
}

function stubFetch(response: Response | (() => Response)): FetchCall[] {
  const calls: FetchCall[] = [];
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return Promise.resolve(
      typeof response === "function" ? response() : response.clone(),
    );
  }) as typeof fetch;
  return calls;
}

const json = (status: number, payload: unknown) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });

const JOB = {
  id: "00000000-0000-4000-8000-000000000001",
  kind: "draft",
  status: "queued",
  prompt: "a 10mm cube",
  generationId: "gen-1",
  createdAt: "2026-11-17T12:00:00.000Z",
  expiresAt: "2026-11-18T12:00:00.000Z",
};

const headerOf = (call: FetchCall, name: string) =>
  new Headers(call.init.headers).get(name);

const originalFetch = globalThis.fetch;

beforeEach(() => {
  process.env.VITE_FACET_API_URL = API_URL;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.VITE_FACET_API_URL;
});

describe("parseJob", () => {
  test("reads a finished job's code and a failed job's user-safe error", () => {
    expect(
      parseJob({ ...JOB, status: "succeeded", code: "return cube(1);" }),
    ).toMatchObject({ status: "succeeded", code: "return cube(1);" });
    expect(
      parseJob({
        ...JOB,
        status: "failed",
        error: { code: "out_of_credits", message: "Out.", status: 402 },
      }),
    ).toMatchObject({
      status: "failed",
      error: { code: "out_of_credits", message: "Out.", status: 402 },
    });
  });

  test("rejects anything that is not a job, and an unknown status", () => {
    expect(parseJob(null)).toBeNull();
    expect(parseJob({ ...JOB, id: 7 })).toBeNull();
    expect(parseJob({ ...JOB, status: "exploded" })).toBeNull();
  });

  test("a succeeded job without code is not usable", () => {
    expect(parseJob({ ...JOB, status: "succeeded" })).toBeNull();
  });

  test("a failed job without a message falls back to a generic one", () => {
    expect(parseJob({ ...JOB, status: "failed" })?.error?.message).toBe(
      "AI generation failed. Please try again.",
    );
  });
});

describe("enqueueGeneration", () => {
  test("POSTs the prompt to /generations with a bearer token and returns the job", async () => {
    const calls = stubFetch(json(202, { job: JOB }));

    const job = await enqueueGeneration("a 10mm cube", managed);

    expect(calls[0]!.url).toBe(`${API_URL}/generations`);
    expect(calls[0]!.init.method).toBe("POST");
    expect(headerOf(calls[0]!, "authorization")).toBe(`Bearer ${TOKEN}`);
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({
      prompt: "a 10mm cube",
    });
    expect(job).toMatchObject({ id: JOB.id, status: "queued" });
  });

  test("a refusal throws a GenerateError with the status and stable code", async () => {
    stubFetch(json(402, { error: "Buy credits.", code: "payment_required" }));

    const err = await enqueueGeneration("a cube", managed).catch((e) => e);

    expect(err).toBeInstanceOf(GenerateError);
    expect(err).toMatchObject({
      status: 402,
      code: "payment_required",
      message: "Buy credits.",
    });
  });

  test("a malformed reply is a generic failure", async () => {
    stubFetch(json(202, { job: { nope: true } }));

    const err = await enqueueGeneration("a cube", managed).catch((e) => e);

    expect(err).toBeInstanceOf(GenerateError);
    expect(err.message).toBe("AI generation failed. Please try again.");
  });
});

describe("listGenerations", () => {
  test("GETs the caller's jobs with a bearer token, skipping malformed entries", async () => {
    const calls = stubFetch(json(200, { jobs: [JOB, { junk: 1 }] }));

    const jobs = await listGenerations(managed);

    expect(calls[0]!.url).toBe(`${API_URL}/generations`);
    expect(headerOf(calls[0]!, "authorization")).toBe(`Bearer ${TOKEN}`);
    expect(jobs?.map((j) => j.id)).toEqual([JOB.id]);
  });

  test("an older gateway without jobs reads as an empty list", async () => {
    stubFetch(json(404, { error: "not found" }));
    expect(await listGenerations(managed)).toEqual([]);
  });

  test("any other failure is unknown (null), so the shown list is kept", async () => {
    stubFetch(json(503, { error: "down" }));
    expect(await listGenerations(managed)).toBeNull();

    globalThis.fetch = (() =>
      Promise.reject(new Error("offline"))) as unknown as typeof fetch;
    expect(await listGenerations(managed)).toBeNull();
  });

  test("signed out reads as unknown without calling the gateway", async () => {
    const calls = stubFetch(json(200, { jobs: [] }));
    expect(
      await listGenerations({ getAccessToken: async () => null }),
    ).toBeNull();
    expect(calls).toHaveLength(0);
  });
});

describe("dismissGeneration", () => {
  test("DELETEs the job with a bearer token", async () => {
    const calls = stubFetch(() => new Response(null, { status: 204 }));

    expect(await dismissGeneration(JOB.id, managed)).toBe(true);
    expect(calls[0]!.url).toBe(`${API_URL}/generations/${JOB.id}`);
    expect(calls[0]!.init.method).toBe("DELETE");
    expect(headerOf(calls[0]!, "authorization")).toBe(`Bearer ${TOKEN}`);
  });

  test("an already-gone job counts as dismissed; other failures do not", async () => {
    stubFetch(json(404, {}));
    expect(await dismissGeneration(JOB.id, managed)).toBe(true);
    stubFetch(json(503, {}));
    expect(await dismissGeneration(JOB.id, managed)).toBe(false);
  });

  test("encodes the id into the path", async () => {
    const calls = stubFetch(() => new Response(null, { status: 204 }));
    await dismissGeneration("a/b", managed);
    expect(calls[0]!.url).toBe(`${API_URL}/generations/a%2Fb`);
  });
});
