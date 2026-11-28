import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fetchAccountUsage, savedUsageAuthorization, usageAuthorization } from "../extensions/account-usage.ts";

async function resolveAuthorization() {
  const agentDir = process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
  const authPath = join(agentDir, "auth.json");
  let saved: string | undefined;
  try {
    saved = savedUsageAuthorization(await readFile(authPath, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return saved ?? usageAuthorization(process.env);
}

const usage = await fetchAccountUsage(resolveAuthorization);
if (usage.status === "available") {
  console.log(usage.chatRequests);
} else {
  console.error(usage.status === "unconfigured"
    ? "Run /login sakura-usage or set SAKURA_ACCESS_TOKEN and SAKURA_ACCESS_TOKEN_SECRET."
    : usage.reason);
  process.exitCode = 1;
}
