import { createProvider, openAICompletionsApi } from "@earendil-works/pi-ai/compat";
import type { Model } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { accountUsageProvider, fetchAccountUsage } from "./account-usage.ts";
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
  // Expose every Pi thinking level; actual support is determined by the upstream model.
  thinkingLevelMap: { xhigh: "xhigh", max: "max" },
  input: [...spec.input],
  contextWindow: spec.contextWindow,
  maxTokens: spec.maxTokens,
  // Sakura bills in JPY; Pi's USD cost fields cannot represent those rates.
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  compat: { supportsDeveloperRole: false, maxTokensField: "max_tokens" },
}));

export default function (pi: ExtensionAPI) {
  // Use the bundled catalog until the remote list is retrieved successfully.
  // A successful response replaces the visible model list, including an empty list.
  let activeModels: SakuraModel[] = ALL_MODELS;
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
    getModels: () => activeModels,
    getAllModels: () => activeModels,
    async refreshModels(context) {
      if (!context.allowNetwork) return;
      const token = context.credential?.type === "api_key"
        ? context.credential.key
        : process.env.SAKURA_AI_TOKEN;

      if (!token) {
        syncStatus = {
          message: "No API token. Run /login or set SAKURA_AI_TOKEN. Current model list is unchanged.",
          level: "warning",
        };
        return;
      }

      try {
        // GET /v1/models is not in the published Inference API specification.
        // Only a valid, successful response changes the visible model list.
        const response = await fetch(`${BASE_URL}/models`, {
          headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
          signal: AbortSignal.any([context.signal, AbortSignal.timeout(5000)]),
        });

        if (response.status === 401 || response.status === 403) {
          syncStatus = {
            message: `Model catalog returned HTTP ${response.status}. Check the token and account permissions. Current model list is unchanged.`,
            level: "error",
          };
          return;
        }
        if (!response.ok) {
          syncStatus = {
            message: `Model catalog returned HTTP ${response.status}; availability could not be verified. Current model list is unchanged.`,
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
            message: "Unexpected model catalog format. Current model list is unchanged.",
            level: "warning",
          };
          return;
        }

        const ids: string[] = payload.data.map((row: { id: string }) => row.id);
        const result = classifyCatalog(ids);
        const available = new Set<string>(result.supported.map((model) => model.id));
        const next = ALL_MODELS.filter((model) => available.has(model.id));
        // Publish through Pi so its model registry refresh sees the new list.
        // Do not alter the list if this refresh has been superseded.
        const published = await context.publish({
          update: () => { activeModels = next; },
        });
        if (!published) return;

        const missing = MODEL_SPECS.length - next.length;
        syncStatus = {
          message: `Catalog lists ${next.length}/${MODEL_SPECS.length} supported models` +
            (missing ? `; ${missing} absent models hidden` : "") +
            (result.unknown.length ? `; ${result.unknown.length} unknown IDs ignored` : "") +
            ". Verify the API list if a model is missing.",
          level: missing ? "warning" : "info",
        };
      } catch {
        if (context.signal.aborted) return;
        // Never log tokens, request headers, or upstream response bodies.
        syncStatus = {
          message: "Model catalog unavailable. Current model list is unchanged.",
          level: "warning",
        };
      }
    },
  });
  pi.registerProvider(accountUsageProvider);

  pi.registerCommand("sakura-sync", {
    description: "Refresh the Sakura model catalog from the service",
    async handler(_args, ctx) {
      const result = await ctx.modelRegistry.refresh({
        providers: ["sakura"], force: true, signal: ctx.signal,
      });
      if (result.aborted) {
        ctx.ui.notify("Sakura model check cancelled", "warning");
      } else if (result.errors.has("sakura")) {
        ctx.ui.notify("Sakura model check failed; current model list is unchanged", "warning");
      } else {
        ctx.ui.notify(`Sakura: ${syncStatus.message}`, syncStatus.level);
      }
    },
  });

  pi.registerCommand("sakura-usage", {
    description: "Show Sakura account usage and this Pi session's usage and reference cost",
    async handler(_args, ctx) {
      const totals = summarizeSession(ctx.sessionManager.getEntries());
      const accountUsage = await fetchAccountUsage(ctx.modelRegistry, ctx.signal);
      let serverUsage: string;
      if (accountUsage.status === "available") {
        const { month, chatRequests, chatLimit } = accountUsage;
        const remaining = Math.max(0, chatLimit - chatRequests);
        serverUsage = `Server Usage (${month} JST, Sakura account)\n` +
          `Chat Completions requests: ${chatRequests.toLocaleString()} / ${chatLimit.toLocaleString()}\n` +
          `Estimated free requests remaining: ${remaining.toLocaleString()}`;
      } else {
        const reason = accountUsage.status === "unconfigured"
          ? "Run /login sakura-usage or set SAKURA_ACCESS_TOKEN and SAKURA_ACCESS_TOKEN_SECRET to query account usage."
          : accountUsage.reason;
        serverUsage = `Server Usage (unavailable)\n${reason}\n` +
          `Published free allowance reference: up to ${FREE_CHAT_REQUESTS_PER_MONTH.toLocaleString()} chat requests/month.`;
      }

      ctx.ui.notify(
        `${serverUsage}\n\n` +
        `Session Usage (Sakura, all branches in this Pi session)\n` +
        `Recorded responses: ${totals.responses} (completed: ${totals.completed}, failed/aborted: ${totals.failed}, other: ${totals.other})\n` +
        `Token usage: input ${totals.input}, output ${totals.output}\n` +
        `Additional usage records: ${totals.usageEntries}; responses with unavailable usage: ${totals.unmeteredResponses}\n` +
        `Reference token-based price: ¥${totals.referenceJPY.toFixed(4)}` +
        (totals.unpriced ? ` (${totals.unpriced} unpriced records)` : "") +
        "\nThe session price uses recorded tokens and published unit prices, before free-tier and billing adjustments.",
        accountUsage.status === "unavailable" ? "warning" : "info",
      );
    },
  });
}
