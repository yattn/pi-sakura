import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Only register models that support tool calling in Sakura AI Engine.
// Source: https://manual.sakura.ad.jp/cloud/ai-engine/chat-models.html
const models = [
  { id: "gpt-oss-120b", name: "GPT OSS 120B", contextWindow: 131072, maxTokens: 32000, input: ["text"] },
  { id: "preview/gemma-4-31B-it", name: "Gemma 4 31B", contextWindow: 262144, maxTokens: 32000, input: ["text", "image"] },
  { id: "preview/Qwen3.6-35B-A3B", name: "Qwen3.6 35B A3B", contextWindow: 262144, maxTokens: 32000, input: ["text", "image"] },
  { id: "preview/Kimi-K2.7-Code", name: "Kimi K2.7 Code", contextWindow: 262144, maxTokens: 32000, input: ["text", "image"] },
  { id: "preview/GLM-5.3-Flash", name: "GLM 5.3 Flash", contextWindow: 1048575, maxTokens: 32000, input: ["text", "image"] },
  { id: "preview/DeepSeek-V4.1-Flash-1017", name: "DeepSeek V4.1 Flash 1017", contextWindow: 1048575, maxTokens: 32000, input: ["text", "image"] },
] as const;

export default function (pi: ExtensionAPI) {
  pi.registerProvider("sakura", {
    name: "Sakura AI Engine",
    baseUrl: "https://api.ai.sakura.ad.jp/v1",
    api: "openai-completions",
    apiKey: "$SAKURA_AI_TOKEN",
    authHeader: true,
    models: models.map((model) => ({
      type: "chat" as const,
      ...model,
      input: [...model.input],
      reasoning: true,
      // Pi expects USD / 1M tokens, but Sakura bills in JPY.
      // Do not pretend the free tier or an exchange rate is a fixed price.
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      compat: {
        supportsDeveloperRole: false,
        maxTokensField: "max_tokens" as const,
      },
    })),
  });
}
