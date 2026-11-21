import { createProvider, openAICompletionsApi } from "@earendil-works/pi-ai/compat";
import type { Model } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { BASE_URL, FREE_CHAT_REQUESTS_PER_MONTH, MODEL_SPECS, classifyCatalog, summarizeSession } from "./catalog.ts";

type SakuraModel = Model<"openai-completions">;

const ALL_MODELS: SakuraModel[] = MODEL_SPECS.map((spec) => ({
  type: "chat",
  provider: "sakura",
  api: "openai-completions",
  baseUrl: BASE_URL,
  id: spec.id,
  name: spec.name,
  reasoning: true,
  input: [...spec.input],
  contextWindow: spec.contextWindow,
  maxTokens: spec.maxTokens,
  // Sakura bills in JPY; Pi's USD cost fields cannot represent those rates.
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  compat: { supportsDeveloperRole: false, maxTokensField: "max_tokens" },
}));

export default function (pi: ExtensionAPI) {
  let activeModels: SakuraModel[] = ALL_MODELS;
  let syncStatus = "Not checked";

  const provider = createProvider({
    id: "sakura",
    name: "Sakura AI Engine",
    baseUrl: BASE_URL,
    auth: {
      apiKey: {
        name: "Sakura AI Engine account token",
        async login(interaction) {
          const key = (await interaction.prompt({
            type: "secret",
            message: "Enter your Sakura AI Engine account token",
          })).trim();
          if (!key) throw new Error("Account token is empty");
          return { type: "api_key" as const, key };
        },
        async resolve({ ctx, credential, signal }) {
          signal.throwIfAborted();
          const key = credential?.key || (await ctx.env("SAKURA_AI_TOKEN"));
          signal.throwIfAborted();
          return key
            ? { auth: { apiKey: key }, source: credential?.key ? "stored account token" : "SAKURA_AI_TOKEN" }
            : undefined;
        },
      },
    },
    models: ALL_MODELS,
    api: openAICompletionsApi(),
  });

  pi.registerProvider({
    ...provider,
    getModels: () => activeModels,
    getAllModels: () => activeModels,
    async refreshModels(context) {
      if (!context.allowNetwork) return;
      const token = context.credential?.type === "api_key"
        ? context.credential.key
        : process.env.SAKURA_AI_TOKEN;
      if (!token) {
        syncStatus = "No account token (using bundled list)";
        return;
      }

      try {
        // /v1/models works in practice but is not documented in the Inference API spec.
        const response = await fetch(`${BASE_URL}/models`, {
          headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
          signal: AbortSignal.any([context.signal, AbortSignal.timeout(5000)]),
        });
        if (!response.ok) {
          syncStatus = `Model discovery HTTP ${response.status} (keeping previous list)`;
          return;
        }
        const payload: unknown = await response.json();
        if (!payload || typeof payload !== "object" || !("data" in payload) ||
            !Array.isArray(payload.data) ||
            !payload.data.every((row: unknown) =>
              row && typeof row === "object" && "id" in row && typeof row.id === "string")) {
          syncStatus = "Invalid model response (keeping previous list)";
          return;
        }
        const ids = payload.data.map((row: { id: string }) => row.id);
        const result = classifyCatalog(ids);
        if (!result.supported.length) {
          syncStatus = "No recognized tool-capable models (keeping previous list)";
          return;
        }
        const selected = new Set<string>(result.supported.map((model) => model.id));
        const next = ALL_MODELS.filter((model) => selected.has(model.id));
        const published = await context.publish({ update: () => { activeModels = next; } });
        if (published) {
          syncStatus = `${next.length} known models available` +
            (result.unknown.length ? ` (${result.unknown.length} unknown IDs ignored)` : "");
        }
      } catch {
        if (context.signal.aborted) return;
        // Never log a token, request headers, or the remote response body.
        syncStatus = "Model discovery unavailable (keeping previous list)";
      }
    },
  });

  pi.registerCommand("sakura-sync", {
    description: "Refresh the Sakura model catalog from the service",
    async handler(_args, ctx) {
      const result = await ctx.modelRegistry.refresh({
        providers: ["sakura"], force: true, signal: ctx.signal,
      });
      if (result.errors.has("sakura")) {
        ctx.ui.notify("Sakura refresh failed; existing models remain available", "warning");
      } else {
        ctx.ui.notify(`Sakura: ${syncStatus}`, "info");
      }
    },
  });

  pi.registerCommand("sakura-usage", {
    description: "Show Sakura usage and reference JPY cost for this Pi session",
    async handler(_args, ctx) {
      const totals = summarizeSession(ctx.sessionManager.getEntries());
      ctx.ui.notify(
        `Sakura (this session only, including abandoned branches)\n` +
        `Responses: ${totals.requests}, input: ${totals.input}, output: ${totals.output} tokens\n` +
        `Reference token-based price: ¥${totals.referenceJPY.toFixed(4)}` +
        (totals.unpriced ? ` (${totals.unpriced} unpriced model responses)` : "") +
        `\nFree allowance: up to ${FREE_CHAT_REQUESTS_PER_MONTH.toLocaleString()} chat requests/month for the entire account; remaining balance unknown.\n` +
        "Not a bill: excludes other sessions/apps, failed requests, free-tier accounting, and billing minimums.",
        "info",
      );
    },
  });
}
