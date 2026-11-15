import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { buildTrialRequest, sha256, TRIAL_CASES, TRIAL_ENABLE_VALUE, TRIAL_ID,
  MODEL_REPOSITORY_COMMIT, TOKENIZER_URL, ENCODER_URL, TOKENIZER_SHA256, ENCODER_SHA256, CLOUDFLARE_AUTHORITY } from "../src/trial.mjs";

export const schema = readFileSync(new URL("../migrations/0001_deepseek_trial_budget.sql", import.meta.url), "utf8");
export function database(file = ":memory:", initialize = true) {
  const sqlite = new DatabaseSync(file);
  sqlite.exec("PRAGMA busy_timeout=10000");
  if (initialize) sqlite.exec(schema);
  return {
    sqlite,
    prepare(sql) { return { bind(...args) { return {
      async run() { const value = sqlite.prepare(sql).run(...args); return { success: true, meta: { changes: value.changes } }; },
      async first() { return sqlite.prepare(sql).get(...args) ?? null; },
    }; } }; },
  };
}
export function environment(DB = database()) {
  return { DB, ACCESS_TOKEN: "synthetic-personal-token-not-a-live-secret-123",
    DEEPSEEK_API_KEY: "synthetic-official-key-not-a-live-secret", DEEPSEEK_TRIAL_ENABLED: TRIAL_ENABLE_VALUE };
}
export function request(text, env, id = crypto.randomUUID(), init = {}) {
  return new Request("https://trial.invalid/translate", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.ACCESS_TOKEN}` },
    body: JSON.stringify({ text, requestId: id }), ...init,
  });
}
export async function proof() {
  const reviewedAt = Date.now();
  return { schema: "deepseek-token-proof-v1", status: "verified", executionAuthority: CLOUDFLARE_AUTHORITY, verifiedWithOfficialChatTemplate: true,
    reviewedAt: new Date(reviewedAt).toISOString(), expiresAt: new Date(reviewedAt + 86400000).toISOString(),
    modelRepositoryCommit: MODEL_REPOSITORY_COMMIT, tokenizerUrl: TOKENIZER_URL, encoderUrl: ENCODER_URL,
    trialId: TRIAL_ID, model: "deepseek-flash", maxInputTokens: 32768,
    maxOutputTokens: 512, currency: "CNY", inputPricePerMillion: 2, outputPricePerMillion: 8,
    reservationMicroCny: 250000, totalMicroCny: 1000000, maxAttempts: 4,
    tokenizerSha256: TOKENIZER_SHA256, encoderSha256: ENCODER_SHA256, cases: await Promise.all(TRIAL_CASES.map(async (entry) => ({
      id: entry.id, inputTokensUpperBound: 1000, payloadSha256: await sha256(JSON.stringify(buildTrialRequest(entry.text))),
    }))) };
}
export function modelResponse(translation, change = (value) => value) {
  return Response.json(change({ choices: [{ finish_reason: "stop", message: { role: "assistant",
    content: JSON.stringify({ translation }) } }], usage: { prompt_tokens: 1000, completion_tokens: 100 } }));
}
export function row(env) { return env.DB.sqlite.prepare("SELECT * FROM deepseek_trial_budget").get(); }
