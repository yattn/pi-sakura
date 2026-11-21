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
  // The catalog endpoint is undocumented: discovery is advisory only.
  // Never remove models from Pi's bundled list based on an incomplete response.
  let syncStatus: { message: string; level: "info" | "warning" | "error" } = {
    message: "Not checked (using bundled models)",
    level: "info",
  };

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
    async refreshModels(context) {
      if (!context.allowNetwork) return;
      const token = context.credential?.type === "api_key"
        ? context.credential.key
        : process.env.SAKURA_AI_TOKEN;

      if (!token) {
        syncStatus = {
          message: "No API token. Run /login or set SAKURA_AI_TOKEN. Bundled models remain listed.",
          level: "warning",
        };
        return;
      }

      try {
        // GET /v1/models is not an officially documented inference endpoint.
        // This is a diagnostic check, not a source of truth for availability.
        const response = await fetch(`${BASE_URL}/models`, {
          headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
          signal: AbortSignal.any([context.signal, AbortSignal.timeout(5000)]),
        });

        if (response.status === 401 || response.status === 403) {
          syncStatus = {
            message: `Model catalog returned HTTP ${response.status}. Check the token and account permissions. Bundled models remain listed.`,
            level: "error",
          };
          return;
        }
        if (!response.ok) {
          syncStatus = {
            message: `Model catalog returned HTTP ${response.status}; availability could not be verified. Bundled models remain listed.`,
            level: "warning",
          };
          return;
        }

        const payload: unknown = await response.json();
        if (!payload || typeof payload !== "object" || !("data" in payload) ||
            !Array.isArray(payload.data) ||
            !payload.data.every((row: unknown) =>
              row && typeof row === "object" && "id" in row && typeof row.id === "string")) {
          syncStatus = {
            message: "Unexpected model catalog format. Bundled models remain listed.",
            level: "warning",
          };
          return;
        }

        const ids: string[] = payload.data.map((row: { id: string }) => row.id);
        const result = classifyCatalog(ids);
        const missing = MODEL_SPECS.length - result.supported.length;
        syncStatus = {
          message: `Catalog reports ${result.supported.length}/${MODEL_SPECS.length} bundled models` +
            (missing ? `; ${missing} not listed (still selectable)` : "") +
            (result.unknown.length ? `; ${result.unknown.length} unknown IDs ignored` : "") +
            ". This endpoint is unofficial; no models were removed.",
          level: missing ? "warning" : "info",
        };
      } catch {
        if (context.signal.aborted) return;
        // Never log tokens, request headers, or upstream response bodies.
        syncStatus = {
          message: "Model catalog unavailable. Bundled models remain listed.",
          level: "warning",
        };
      }
    },
  });

  pi.registerCommand("sakura-sync", {
    description: "Refresh the Sakura model catalog from the service",
    async handler(_args, ctx) {
      const result = await ctx.modelRegistry.refresh({
        providers: ["sakura"], force: true, signal: ctx.signal,
      });
      if (result.aborted) {
        ctx.ui.notify("Sakura model check cancelled", "warning");
      } else if (result.errors.has("sakura")) {
        ctx.ui.notify("Sakura model check failed; bundled models remain available", "warning");
      } else {
        ctx.ui.notify(`Sakura: ${syncStatus.message}`, syncStatus.level);
      }
    },
  });

  pi.registerCommand("sakura-usage", {
    description: "Show Sakura usage and reference JPY cost for this Pi session",
    async handler(_args, ctx) {
      const totals = summarizeSession(ctx.sessionManager.getEntries());
      ctx.ui.notify(
        `Sakura (this session only, including abandoned branches)\n` +
        `Recorded responses: ${totals.responses} (completed: ${totals.completed}, failed/aborted: ${totals.failed}, other: ${totals.other})\n` +
        `Token usage: input ${totals.input}, output ${totals.output}\n` +
        `Additional usage records: ${totals.usageEntries}; responses with unavailable usage: ${totals.unmeteredResponses}\n` +
        `Reference token-based price: ¥${totals.referenceJPY.toFixed(4)}` +
        (totals.unpriced ? ` (${totals.unpriced} unpriced records)` : "") +
        `\nFree allowance: up to ${FREE_CHAT_REQUESTS_PER_MONTH.toLocaleString()} chat requests/month for the entire account; remaining balance unknown.\n` +
        "Not a bill or request count: excludes other sessions/apps and requests without recorded usage; free-tier and billing minimums are not applied.",
        "info",
      );
    },
  });
}
