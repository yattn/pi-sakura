// Model capabilities: https://manual.sakura.ad.jp/cloud/ai-engine/chat-models.html
// JPY rates (tax included), per 10,000 tokens:
// https://ai.sakura.ad.jp/sakura-ai/ai-engine/
// Rates are reference values, NOT Pi's USD price metadata.
export const BASE_URL = "https://api.ai.sakura.ad.jp/v1";
export const FREE_CHAT_REQUESTS_PER_MONTH = 3000;

export const MODEL_SPECS = [
  { id: "gpt-oss-120b", name: "GPT OSS 120B", contextWindow: 131072, maxTokens: 32000, input: ["text"], inputJPY: 0.15, outputJPY: 0.75 },
  { id: "preview/gemma-4-31B-it", name: "Gemma 4 31B", contextWindow: 262144, maxTokens: 32000, input: ["text", "image"], inputJPY: 0.24, outputJPY: 0.96 },
  { id: "preview/Qwen3.6-35B-A3B", name: "Qwen3.6 35B A3B", contextWindow: 262144, maxTokens: 32000, input: ["text", "image"], inputJPY: 0.3, outputJPY: 1.5 },
  { id: "preview/Kimi-K2.7-Code", name: "Kimi K2.7 Code", contextWindow: 262144, maxTokens: 32000, input: ["text", "image"], inputJPY: 0.52, outputJPY: 5.04 },
  { id: "preview/GLM-5.3-Flash", name: "GLM 5.3 Flash", contextWindow: 1048575, maxTokens: 32000, input: ["text", "image"], inputJPY: 0.4, outputJPY: 4 },
  { id: "preview/DeepSeek-V4.1-Flash-1017", name: "DeepSeek V4.1 Flash 1017", contextWindow: 1048575, maxTokens: 32000, input: ["text", "image"], inputJPY: 0.4, outputJPY: 4 },
] as const;

export function classifyCatalog(ids: readonly string[]) {
  const available = new Set(ids);
  const known = new Set<string>(MODEL_SPECS.map((model) => model.id));
  return {
    supported: MODEL_SPECS.filter((model) => available.has(model.id)),
    unknown: [...available].filter((id) => !known.has(id)).sort(),
  };
}

// Reads only the current session file. Includes abandoned conversation branches,
// because those API calls can still be billed. Not account-wide usage.
export function summarizeSession(entries: readonly unknown[]) {
  const rates = new Map(MODEL_SPECS.map((model) => [model.id, model]));
  let requests = 0;
  let input = 0;
  let output = 0;
  let referenceJPY = 0;
  let unpriced = 0;

  const add = (modelId: string, usage: { input: number; output: number }) => {
    requests++;
    input += usage.input;
    output += usage.output;
    const rate = rates.get(modelId);
    if (!rate) { unpriced++; return; }
    referenceJPY += (usage.input * rate.inputJPY + usage.output * rate.outputJPY) / 10000;
  };

  for (const value of entries) {
    if (!value || typeof value !== "object") continue;
    const entry = value as Record<string, any>;
    let modelId: string | undefined;
    let usage: { input: number; output: number } | undefined;
    if (entry.type === "message" && entry.message?.role === "assistant" && entry.message.provider === "sakura") {
      modelId = entry.message.model;
      usage = entry.message.usage;
    } else if (entry.type === "usage" && entry.provider === "sakura") {
      modelId = entry.model;
      usage = entry.usage;
    }
    if (typeof modelId !== "string" || !usage) continue;
    if (!Number.isFinite(usage.input) || !Number.isFinite(usage.output) || usage.input < 0 || usage.output < 0) continue;
    add(modelId, usage);
  }

  return { requests, input, output, referenceJPY, unpriced };
}
