const CLOUD_AI_URL = "https://secure.sakura.ad.jp/cloud/api/ai/1.0";
export const USAGE_PROVIDER_ID = "sakura-usage";
export const ACCESS_TOKEN_ENV = "SAKURA_ACCESS_TOKEN";
export const ACCESS_TOKEN_SECRET_ENV = "SAKURA_ACCESS_TOKEN_SECRET";
const JST_OFFSET_HOURS = 9;
const REQUEST_TIMEOUT_MS = 5000;

type AccountUsage =
  | { status: "available"; month: string; chatRequests: number; chatLimit: number }
  | { status: "unconfigured" }
  | { status: "unavailable"; reason: string };

class CloudUsageError extends Error {}

export function usageAuthorization(env?: Record<string, unknown>): string | undefined {
  const accessToken = env?.[ACCESS_TOKEN_ENV];
  const secret = env?.[ACCESS_TOKEN_SECRET_ENV];
  if (typeof accessToken !== "string" || typeof secret !== "string") return undefined;
  const token = accessToken.trim();
  const password = secret.trim();
  if (token && password) {
    return `Basic ${Buffer.from(`${token}:${password}`).toString("base64")}`;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
}

export function savedUsageAuthorization(content: string): string | undefined {
  const credential = asRecord(asRecord(JSON.parse(content))?.[USAGE_PROVIDER_ID]);
  if (credential?.type === "api_key") return usageAuthorization(asRecord(credential.env));
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function readChatRequests(payload: unknown, monthStart: Date): number | undefined {
  const results = asRecord(payload)?.results;
  if (!Array.isArray(results)) return undefined;
  if (results.length === 0) return 0;

  const rows = results.map(asRecord).filter((row) =>
    typeof row?.time === "string" && Date.parse(row.time) === monthStart.getTime());
  const row = rows[0];
  if (rows.length !== 1 || row?.type !== "request") return undefined;

  const count = asRecord(row.requests)?.chat_completions;
  return isCount(count) ? count : undefined;
}

async function fetchJson(url: string | URL, options: RequestInit): Promise<unknown> {
  const response = await fetch(url, options);
  if (response.ok) return response.json();

  await response.body?.cancel();
  const hint = response.status === 401 || response.status === 403
    ? " Check the Sakura Cloud API key and project permissions."
    : "";
  throw new CloudUsageError(`Sakura Cloud API returned HTTP ${response.status}.${hint}`);
}

export async function fetchAccountUsage(
  resolveAuthorization: () => Promise<string | null | undefined>,
  signal?: AbortSignal,
): Promise<AccountUsage> {
  let authorization: string | null | undefined;
  try {
    authorization = await resolveAuthorization();
  } catch {
    return { status: "unavailable", reason: "Could not read the Sakura Cloud API key from Pi." };
  }
  if (!authorization) return { status: "unconfigured" };

  // The control panel queries JST month boundaries as UTC timestamps.
  const nowJst = new Date(Date.now() + JST_OFFSET_HOURS * 60 * 60 * 1000);
  const year = nowJst.getUTCFullYear();
  const monthIndex = nowJst.getUTCMonth();
  const month = `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
  const monthStart = new Date(Date.UTC(year, monthIndex, 1, -JST_OFFSET_HOURS));
  const monthEnd = new Date(Date.UTC(year, monthIndex + 1, 1, -JST_OFFSET_HOURS));
  const usageUrl = new URL(`${CLOUD_AI_URL}/usages/`);
  usageUrl.search = new URLSearchParams({
    start_at: monthStart.toISOString(),
    end_at: monthEnd.toISOString(),
    type: "request",
  }).toString();

  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const options: RequestInit = {
    headers: {
      Authorization: authorization,
      Accept: "application/json",
    },
    redirect: "error",
    signal: requestSignal,
  };

  try {
    requestSignal.throwIfAborted();
    const [auth, usage] = await Promise.all([
      fetchJson(`${CLOUD_AI_URL}/auth/`, options),
      fetchJson(usageUrl, options),
    ]);
    requestSignal.throwIfAborted();
    const account = asRecord(asRecord(auth)?.account);
    const chatLimit = asRecord(account?.plan)?.request_limit_chat_completions;
    const chatRequests = readChatRequests(usage, monthStart);
    if (!isCount(chatLimit) || chatRequests === undefined) {
      return { status: "unavailable", reason: "Unexpected Sakura Cloud usage response." };
    }
    return { status: "available", month, chatRequests, chatLimit };
  } catch (error) {
    // Only display our own diagnostic text. Upstream errors may contain sensitive data.
    let reason = "Could not reach the Sakura Cloud usage API.";
    if (signal?.aborted) reason = "Sakura Cloud usage request cancelled.";
    else if (timeout.aborted) reason = "Sakura Cloud usage request timed out.";
    else if (error instanceof CloudUsageError) reason = error.message;
    else if (error instanceof SyntaxError) reason = "Unexpected Sakura Cloud usage response.";
    return { status: "unavailable", reason };
  }
}
