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

// Reads only the current Pi session file, including abandoned branches.
// Response counts are NOT request counts: retries and transport failures may
// not produce a saved assistant message. Usage entries may describe extra
// metered operations, not chat responses.
export function summarizeSession(entries: readonly unknown[]) {
  const rates = new Map<string, (typeof MODEL_SPECS)[number]>(
    MODEL_SPECS.map((model) => [model.id, model]),
  );
  let responses = 0;
  let completed = 0;
  let failed = 0;
  let other = 0;
  let usageEntries = 0;
  let unmeteredResponses = 0;
  let input = 0;
  let output = 0;
  let referenceJPY = 0;
  let unpriced = 0;

  const addUsage = (modelId: string, usage: unknown): boolean => {
    if (!usage || typeof usage !== "object") return false;
    const u = usage as Record<string, unknown>;
    if (typeof u.input !== "number" || typeof u.output !== "number" ||
        !Number.isFinite(u.input) || !Number.isFinite(u.output) ||
        u.input < 0 || u.output < 0) return false;

    input += u.input;
    output += u.output;
    const rate = rates.get(modelId);
    if (rate) {
      referenceJPY += (u.input * rate.inputJPY + u.output * rate.outputJPY) / 10000;
    } else {
      unpriced++;
    }
    return true;
  };

  for (const value of entries) {
    if (!value || typeof value !== "object") continue;
    const entry = value as Record<string, any>;
    if (entry.type === "message" && entry.message?.role === "assistant" &&
        entry.message.provider === "sakura") {
      const message = entry.message as Record<string, unknown>;
      responses++;
      if (message.stopReason === "error" || message.stopReason === "aborted") {
        failed++;
      } else if (message.stopReason === "stop" || message.stopReason === "length" ||
                 message.stopReason === "toolUse") {
        completed++;
      } else {
        other++;
      }
      if (typeof message.model !== "string" || !addUsage(message.model, message.usage)) {
        unmeteredResponses++;
      }
    } else if (entry.type === "usage" && entry.provider === "sakura" &&
               typeof entry.model === "string") {
      if (addUsage(entry.model, entry.usage)) usageEntries++;
    }
  }

  return {
    responses, completed, failed, other, usageEntries, unmeteredResponses,
    input, output, referenceJPY, unpriced,
  };
}
