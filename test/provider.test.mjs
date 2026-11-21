import assert from "node:assert/strict";
import test from "node:test";
import register from "../extensions/sakura.ts";

test("registers only the six tool-capable models listed by Sakura", () => {
  const calls = [];
  register({ registerProvider: (id, config) => calls.push({ id, config }) });
  assert.equal(calls.length, 1);

  const { id, config } = calls[0];
  assert.equal(id, "sakura");
  assert.equal(config.baseUrl, "https://api.ai.sakura.ad.jp/v1");
  assert.equal(config.api, "openai-completions");
  assert.equal(config.apiKey, "$SAKURA_AI_TOKEN");
  assert.equal(config.authHeader, true);
  assert.deepEqual(config.models.map((model) => model.id), [
    "gpt-oss-120b",
    "preview/gemma-4-31B-it",
    "preview/Qwen3.6-35B-A3B",
    "preview/Kimi-K2.7-Code",
    "preview/GLM-5.3-Flash",
    "preview/DeepSeek-V4.1-Flash-1017",
  ]);

  for (const model of config.models) {
    assert.equal(model.type, "chat");
    assert.equal(model.reasoning, true);
    assert.ok(model.contextWindow > model.maxTokens);
    assert.deepEqual(model.compat, {
      supportsDeveloperRole: false,
      maxTokensField: "max_tokens",
    });
    assert.deepEqual(model.cost, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
  }
  assert.deepEqual(config.models.find((m) => m.id === "gpt-oss-120b").input, ["text"]);
  assert.deepEqual(config.models.find((m) => m.id === "preview/DeepSeek-V4.1-Flash-1017").input, ["text", "image"]);
});
