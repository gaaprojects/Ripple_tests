import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { REPO_ROOT } from "./lib.js";

const ENV_PATH = resolve(REPO_ROOT, ".env");

/** Read current .env into a map (creates from nothing if missing). */
export function readEnvFile(): Map<string, string> {
  const map = new Map<string, string>();
  if (!existsSync(ENV_PATH)) return map;
  for (const line of readFileSync(ENV_PATH, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) map.set(m[1]!, m[2]!);
  }
  return map;
}

/**
 * Upsert keys into .env, preserving existing unrelated lines and comments.
 * Only touches the keys provided.
 */
export function upsertEnv(updates: Record<string, string>): void {
  const lines = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, "utf8").split(/\r?\n/) : [];
  const remaining = new Map(Object.entries(updates));
  const out = lines.map((line) => {
    const m = line.match(/^([A-Z0-9_]+)=/);
    if (m && remaining.has(m[1]!)) {
      const key = m[1]!;
      const val = remaining.get(key)!;
      remaining.delete(key);
      return `${key}=${val}`;
    }
    return line;
  });
  if (remaining.size) {
    out.push("", "# --- written by provisioning ---");
    for (const [k, v] of remaining) out.push(`${k}=${v}`);
  }
  writeFileSync(ENV_PATH, out.join("\n"));
}
