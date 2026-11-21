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

test("registers six tool-capable models, API-key login, and two commands", async () => {
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

test("catalog discovery enables known models only, preserves list on errors", async () => {
  const { provider } = setup();
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ data: [
        { id: "preview/DeepSeek-V4.1-Flash-1017" },
        { id: "future-model-not-yet-reviewed" },
      ] }),
    });
    await provider.refreshModels({
      allowNetwork: true,
      credential: { type: "api_key", key: "test" },
      signal: new AbortController().signal,
      publish: async ({ update }) => { update(); return true; },
    });
    assert.deepEqual(provider.getModels().map((m) => m.id), ["preview/DeepSeek-V4.1-Flash-1017"]);

    globalThis.fetch = async () => ({ ok: false, status: 503 });
    await provider.refreshModels({
      allowNetwork: true,
      credential: { type: "api_key", key: "test" },
      signal: new AbortController().signal,
      publish: async ({ update }) => { update(); return true; },
    });
    assert.deepEqual(provider.getModels().map((m) => m.id), ["preview/DeepSeek-V4.1-Flash-1017"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.deepEqual(classifyCatalog(["gpt-oss-120b", "not-known"]).unknown, ["not-known"]);
});

test("session usage is local and priced in JPY", () => {
  const result = summarizeSession([
    { type: "message", message: { role: "assistant", provider: "sakura", model: "gpt-oss-120b", usage: { input: 10000, output: 10000 } } },
    { type: "message", message: { role: "assistant", provider: "other", model: "gpt-oss-120b", usage: { input: 2000, output: 2000 } } },
    { type: "usage", provider: "sakura", model: "preview/DeepSeek-V4.1-Flash-1017", usage: { input: 10000, output: 10000 } },
  ]);
  assert.ok(Math.abs(result.referenceJPY - 5.3) < 1e-10);
  assert.equal(result.requests, 2);
  assert.equal(result.input, 20000);
  assert.equal(result.output, 20000);
  assert.equal(result.unpriced, 0);
});
