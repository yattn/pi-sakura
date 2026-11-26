import assert from "node:assert/strict";
import test from "node:test";
import { getSupportedThinkingLevels, clampThinkingLevel } from "@earendil-works/pi-ai/compat";
import register from "../extensions/sakura.ts";
import { MODEL_SPECS, classifyCatalog, summarizeSession } from "../extensions/catalog.ts";

function setup() {
  const providers = [];
  const commands = new Map();
  register({
    registerProvider: (provider) => providers.push(provider),
    registerCommand: (name, command) => commands.set(name, command),
  });
  assert.equal(providers.length, 1);
  return { provider: providers[0], commands };
}

function refreshContext() {
  return {
    allowNetwork: true,
    credential: { type: "api_key", key: "test-token" },
    signal: new AbortController().signal,
    publish: async ({ update }) => { update(); return true; },
  };
}

function commandContext(provider, notifications) {
  const context = refreshContext();
  return {
    signal: context.signal,
    ui: { notify: (message, level) => notifications.push({ message, level }) },
    modelRegistry: {
      refresh: async () => {
        await provider.refreshModels(context);
        return { aborted: false, errors: new Map() };
      },
    },
  };
}

test("registers six tool-capable models, secure API-key login, and two commands", async () => {
  const { provider, commands } = setup();
  assert.equal(provider.id, "sakura");
  assert.equal(provider.baseUrl, "https://api.ai.sakura.ad.jp/v1");
  assert.deepEqual(provider.getModels().map((model) => model.id), MODEL_SPECS.map((model) => model.id));
  for (const model of provider.getModels()) {
    assert.equal(model.api, "openai-completions");
    assert.equal(model.reasoning, true);
    const levels = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
    assert.deepEqual(getSupportedThinkingLevels(model), levels);
    for (const level of levels) {
      assert.equal(clampThinkingLevel(model, level), level);
    }
    assert.deepEqual(model.thinkingLevelMap, { xhigh: "xhigh", max: "max" });
    assert.equal(model.compat.maxTokensField, "max_tokens");
    assert.ok(model.contextWindow >= model.maxTokens);
  }
  assert.deepEqual([...commands.keys()], ["sakura-sync", "sakura-usage"]);

  const prompts = [];
  const key = await provider.auth.apiKey.login({
    signal: new AbortController().signal,
    prompt: async (prompt) => { prompts.push(prompt); return "example-secret"; },
  });
  assert.equal(prompts[0].type, "secret");
  assert.deepEqual(key, { type: "api_key", key: "example-secret" });
  const result = await provider.auth.apiKey.resolve({
    credential: key,
    ctx: { env: async () => undefined },
    signal: new AbortController().signal,
  });
  assert.equal(result.auth.apiKey, "example-secret");
});

test("successful catalog replaces visible models, including missing and empty lists", async () => {
  const { provider, commands } = setup();
  const bundled = provider.getModels().map((m) => m.id);
  const originalFetch = globalThis.fetch;

  const notifications = [];
  const sync = async () => {
    notifications.length = 0;
    await commands.get("sakura-sync").handler("", commandContext(provider, notifications));
    assert.equal(notifications.length, 1);
    return notifications[0];
  };

  try {
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: [
        { id: "preview/DeepSeek-V4.1-Flash-1017" },
        { id: "future-model-not-yet-reviewed" },
      ] }),
    });
    const partial = await sync();
    assert.deepEqual(provider.getModels().map((m) => m.id), ["preview/DeepSeek-V4.1-Flash-1017"]);
    assert.deepEqual(provider.getAllModels().map((m) => m.id), ["preview/DeepSeek-V4.1-Flash-1017"]);
    assert.match(partial.message, /1\/6 supported models/);
    assert.match(partial.message, /5 absent models hidden/);
    assert.equal(partial.level, "warning");
    assert.deepEqual(classifyCatalog(["gpt-oss-120b", "not-known"]).unknown, ["not-known"]);

    for (const status of [401, 403, 404, 503]) {
      globalThis.fetch = async () => ({ ok: false, status });
      const note = await sync();
      assert.deepEqual(provider.getModels().map((m) => m.id), ["preview/DeepSeek-V4.1-Flash-1017"]);
      assert.match(note.message, new RegExp(String(status)));
      assert.equal(note.level, status === 401 || status === 403 ? "error" : "warning");
      assert.doesNotMatch(note.message, /test-token/);
    }

    globalThis.fetch = async () => ({ ok: true, json: async () => ({ models: [] }) });
    const invalid = await sync();
    assert.deepEqual(provider.getModels().map((m) => m.id), ["preview/DeepSeek-V4.1-Flash-1017"]);
    assert.match(invalid.message, /Unexpected model catalog format/);

    globalThis.fetch = async () => ({ ok: true, json: async () => ({ data: [] }) });
    const empty = await sync();
    assert.deepEqual(provider.getModels().map((m) => m.id), []);
    assert.match(empty.message, /0\/6 supported models/);

    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ data: bundled.map((id) => ({ id })) }),
    });
    const restored = await sync();
    assert.deepEqual(provider.getModels().map((m) => m.id), bundled);
    assert.match(restored.message, /6\/6 supported models/);
    assert.equal(restored.level, "info");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("usage separates completed and failed replies; no bill or request count inferred", () => {
  const result = summarizeSession([
    { type: "message", message: { role: "assistant", provider: "sakura", model: "gpt-oss-120b", stopReason: "stop", usage: { input: 10000, output: 10000 } } },
    { type: "message", message: { role: "assistant", provider: "sakura", model: "preview/DeepSeek-V4.1-Flash-1017", stopReason: "error", usage: { input: 10000, output: 10000 } } },
    { type: "message", message: { role: "assistant", provider: "sakura", model: "gpt-oss-120b", stopReason: "aborted" } },
    { type: "message", message: { role: "assistant", provider: "sakura", model: "gpt-oss-120b", stopReason: "pending", usage: { input: 0, output: 0 } } },
    { type: "message", message: { role: "assistant", provider: "other", model: "gpt-oss-120b", stopReason: "stop", usage: { input: 2000, output: 2000 } } },
    { type: "usage", provider: "sakura", model: "gpt-oss-120b", usage: { input: 10000, output: 0 } },
    { type: "usage", provider: "sakura", model: "gpt-oss-120b", usage: { input: Number.NaN, output: 0 } },
  ]);
  assert.equal(result.responses, 4);
  assert.equal(result.completed, 1);
  assert.equal(result.failed, 2);
  assert.equal(result.other, 1);
  assert.equal(result.usageEntries, 1);
  assert.equal(result.unmeteredResponses, 1);
  assert.equal(result.input, 30000);
  assert.equal(result.output, 20000);
  assert.ok(Math.abs(result.referenceJPY - 5.45) < 1e-10);
  assert.equal(result.unpriced, 0);
});

const cloudCredentials = {
  SAKURA_ACCESS_TOKEN: "test-cloud-token",
  SAKURA_ACCESS_TOKEN_SECRET: "test-cloud-secret",
};

function setTestEnv(t, env) {
  for (const [key, value] of Object.entries(env)) {
    const previous = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
    t.after(() => {
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    });
  }
}

function cloudAuthResponse(limit = 2500) {
  return Response.json({ account: { plan: { request_limit_chat_completions: limit } } });
}

function monthlyUsageRow(chatRequests, time = "2027-01-01T00:00:00+09:00") {
  return { time, type: "request", requests: { chat_completions: chatRequests } };
}

async function runUsageCommand(signal) {
  const { commands } = setup();
  const notifications = [];
  await commands.get("sakura-usage").handler("", {
    signal,
    sessionManager: { getEntries: () => [
      { type: "message", message: { role: "assistant", provider: "sakura", model: "gpt-oss-120b", stopReason: "stop", usage: { input: 10000, output: 10000 } } },
    ] },
    ui: { notify: (message, level) => notifications.push({ message, level }) },
  });
  assert.equal(notifications.length, 1);
  const note = notifications[0];
  assert.match(note.message, /Session Usage/);
  assert.match(note.message, /Recorded responses: 1/);
  assert.match(note.message, /Reference token-based price: ¥0\.9000/);
  return note;
}

test("usage queries the current JST month and uses the account's actual limit", async (t) => {
  setTestEnv(t, { ...cloudCredentials, SAKURA_AI_TOKEN: "inference-token" });
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-12-31T15:00:00Z") });
  const fetch = t.mock.method(globalThis, "fetch", async (input) => {
    if (String(input).endsWith("/auth/")) return cloudAuthResponse();
    return Response.json({ results: [monthlyUsageRow(179), monthlyUsageRow(711, "2027-02-01T00:00:00+09:00")] });
  });

  const note = await runUsageCommand();
  assert.equal(note.level, "info");
  assert.match(note.message, /Server Usage \(2027-01 JST, Sakura account\)/);
  assert.ok(note.message.includes(`Chat Completions requests: 179 / ${(2500).toLocaleString()}`));
  assert.ok(note.message.includes(`Estimated free requests remaining: ${(2321).toLocaleString()}`));
  const calls = fetch.mock.calls.map(({ arguments: [input, options] }) => {
    assert.equal(options.headers.Authorization, `Basic ${Buffer.from("test-cloud-token:test-cloud-secret").toString("base64")}`);
    assert.equal(options.redirect, "error");
    assert.equal(options.method ?? "GET", "GET");
    return new URL(input);
  });
  const origin = "https://secure.sakura.ad.jp/cloud/api/ai/1.0";
  assert.equal(calls.length, 2);
  assert.equal(calls[0].href, `${origin}/auth/`);
  assert.equal(calls[1].origin + calls[1].pathname, `${origin}/usages/`);
  assert.deepEqual(Object.fromEntries(calls[1].searchParams), {
    start_at: "2026-12-31T15:00:00.000Z",
    end_at: "2027-01-31T15:00:00.000Z",
    type: "request",
  });
  assert.doesNotMatch(note.message, /test-cloud|inference-token/);
});

test("usage with absent or partial cloud credentials stays local", async (t) => {
  setTestEnv(t, { SAKURA_ACCESS_TOKEN: undefined, SAKURA_ACCESS_TOKEN_SECRET: undefined, SAKURA_AI_TOKEN: "inference-token" });
  const fetch = t.mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected request"); });

  let note = await runUsageCommand();
  assert.equal(note.level, "info");
  assert.match(note.message, /Set SAKURA_ACCESS_TOKEN and SAKURA_ACCESS_TOKEN_SECRET/);
  process.env.SAKURA_ACCESS_TOKEN = cloudCredentials.SAKURA_ACCESS_TOKEN;
  note = await runUsageCommand();
  assert.match(note.message, /Server Usage \(unavailable\)/);
  assert.equal(fetch.mock.callCount(), 0);
});

test("usage handles an empty month and clamps remaining requests at zero", async (t) => {
  setTestEnv(t, cloudCredentials);
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2027-01-14T06:00:00Z") });
  let rows = [];
  t.mock.method(globalThis, "fetch", async (input) => String(input).endsWith("/auth/")
    ? cloudAuthResponse(50)
    : Response.json({ results: rows }));

  let note = await runUsageCommand();
  assert.match(note.message, /Chat Completions requests: 0 \/ 50\nEstimated free requests remaining: 50/);
  rows = [monthlyUsageRow(60)];
  note = await runUsageCommand();
  assert.match(note.message, /Chat Completions requests: 60 \/ 50\nEstimated free requests remaining: 0/);
});

test("usage falls back to the session on HTTP errors and malformed upstream data", async (t) => {
  setTestEnv(t, cloudCredentials);
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2027-01-14T06:00:00Z") });
  let usageResponse;
  t.mock.method(globalThis, "fetch", async (input) => String(input).endsWith("/auth/")
    ? cloudAuthResponse()
    : usageResponse());

  for (const [respond, expected] of [
    [() => new Response("private diagnostic", { status: 403 }), /HTTP 403.*project permissions/],
    [() => new Response("private diagnostic", { status: 503 }), /HTTP 503/],
    [() => new Response("private diagnostic"), /Unexpected Sakura Cloud usage response/],
    [() => Response.json({ results: [monthlyUsageRow(-1)] }), /Unexpected Sakura Cloud usage response/],
    [() => { throw new Error("private diagnostic"); }, /Could not reach the Sakura Cloud usage API/],
  ]) {
    usageResponse = respond;
    const note = await runUsageCommand();
    assert.equal(note.level, "warning");
    assert.match(note.message, /Server Usage \(unavailable\)/);
    assert.match(note.message, expected);
    assert.doesNotMatch(note.message, /private diagnostic|Estimated free requests remaining/);
  }
});

test("usage falls back on timeout or cancellation", async (t) => {
  setTestEnv(t, cloudCredentials);
  const timeout = new AbortController();
  const timeoutMock = t.mock.method(AbortSignal, "timeout", () => timeout.signal);
  const fetch = t.mock.method(globalThis, "fetch", async (_url, { signal }) => {
    await new Promise((_, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
  });

  const pending = runUsageCommand();
  timeout.abort();
  assert.match((await pending).message, /timed out/);
  assert.deepEqual(timeoutMock.mock.calls[0].arguments, [5000]);

  const cancelled = new AbortController();
  cancelled.abort();
  assert.match((await runUsageCommand(cancelled.signal)).message, /cancelled/);
  assert.equal(fetch.mock.callCount(), 2);
});
