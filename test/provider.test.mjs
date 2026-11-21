import assert from "node:assert/strict";
import test from "node:test";
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
    // Advisory discovery must not publish updates to the model list.
    publish: async () => { throw new Error("Unexpected model publication"); },
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

test("unofficial partial model catalog never removes bundled models", async () => {
  const { provider, commands } = setup();
  const expected = provider.getModels().map((m) => m.id);
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        data: [
          { id: "preview/DeepSeek-V4.1-Flash-1017" },
          { id: "future-model-not-yet-reviewed" },
        ],
      }),
    });
    const notifications = [];
    await commands.get("sakura-sync").handler("", commandContext(provider, notifications));
    assert.deepEqual(provider.getModels().map((m) => m.id), expected);
    assert.match(notifications[0].message, /1\/6 bundled models/);
    assert.match(notifications[0].message, /5 not listed \(still selectable\)/);
    assert.equal(notifications[0].level, "warning");
    assert.deepEqual(classifyCatalog(["gpt-oss-120b", "not-known"]).unknown, ["not-known"]);

    for (const status of [401, 403, 404, 503]) {
      globalThis.fetch = async () => ({ ok: false, status });
      notifications.length = 0;
      await commands.get("sakura-sync").handler("", commandContext(provider, notifications));
      assert.deepEqual(provider.getModels().map((m) => m.id), expected);
      assert.match(notifications[0].message, new RegExp(String(status)));
      assert.equal(notifications[0].level, status === 401 || status === 403 ? "error" : "warning");
      assert.doesNotMatch(notifications[0].message, /test-token/);
    }

    globalThis.fetch = async () => ({ ok: true, json: async () => ({ models: [] }) });
    notifications.length = 0;
    await commands.get("sakura-sync").handler("", commandContext(provider, notifications));
    assert.deepEqual(provider.getModels().map((m) => m.id), expected);
    assert.match(notifications[0].message, /Unexpected model catalog format/);
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
