import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

export const schema = readFileSync(new URL("../migrations/0001_translation_budget.sql", import.meta.url), "utf8");

// Real SQLite execution with only the D1 binding's result envelope adapted.
export function database(path = ":memory:") {
  const sqlite = new DatabaseSync(path);
  sqlite.exec("PRAGMA busy_timeout=10000");
  sqlite.exec(schema);
  return {
    sqlite,
    prepare(sql) {
      return { bind(...args) {
        return {
          async run() {
            const result = sqlite.prepare(sql).run(...args);
            return { success: true, meta: { changes: result.changes } };
          },
          async first() { return sqlite.prepare(sql).get(...args) ?? null; },
        };
      } };
    },
  };
}

export function environment(DB = database()) {
  return {
    DB, ACCESS_TOKEN: "test-only-access-token-not-a-live-secret-123",
    AZURE_TRANSLATOR_KEY: "test-only-fake-upstream-key", AZURE_TRANSLATOR_REGION: "eastasia",
    AZURE_TIER_CONFIRMED: "F0", MONTHLY_CHARACTER_BUDGET: "1000000", REQUESTS_PER_MINUTE: "6",
  };
}

export function request(text, env, overrides = {}) {
  return new Request("https://translation.example/translate", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.ACCESS_TOKEN}` },
    body: JSON.stringify({ text, requestId: "550e8400-e29b-41d4-a716-446655440000" }),
    ...overrides,
  });
}
