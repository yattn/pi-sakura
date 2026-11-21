import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";

const root = resolve(import.meta.dirname, "..");
const pi = join(root, "node_modules", ".bin", "pi");
const home = mkdtempSync(join(tmpdir(), "pi-sakura-"));
const env = {
  ...process.env,
  HOME: home,
  XDG_CONFIG_HOME: join(home, ".config"),
  PI_CODING_AGENT_DIR: join(home, ".pi", "agent"),
  SAKURA_AI_TOKEN: "offline-smoke-test-only",
};

function run(args) {
  const result = spawnSync(pi, args, {
    cwd: root, env, encoding: "utf8", timeout: 60000,
  });
  assert.equal(result.error, undefined, String(result.error));
  assert.equal(result.status, 0, `pi ${args.join(" ")} failed:\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

try {
  // Exercise Pi's package discovery, not merely the extension factory mock.
  run(["install", "."]);
  // No real token, no provider traffic. Must still load the bundled catalog.
  const output = run(["--offline", "--no-mcp", "--list-models"]);
  assert.match(output, /sakura/);
  assert.match(output, /DeepSeek-V4\.1-Flash-1017/);
} finally {
  rmSync(home, { recursive: true, force: true });
}
