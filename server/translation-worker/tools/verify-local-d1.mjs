// Local workerd D1 binding + production handler; no real Azure or credentials.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createWorker } from "../src/worker.mjs";

// Use the Miniflare version pinned transitively by our fixed Wrangler version.
const require = createRequire(import.meta.url);
const wranglerRequire = createRequire(require.resolve("wrangler/package.json"));
const { Miniflare, convertV4MiniflareOptions } = await import(pathToFileURL(wranglerRequire.resolve("miniflare")).href);
const mf = new Miniflare(convertV4MiniflareOptions({
  modules: true, script: "export default { fetch() { return new Response('local only'); } };",
  compatibilityDate: "2026-11-06", d1Databases: ["DB"],
}));
try {
  const DB = await mf.getD1Database("DB");
  const schema = await readFile(new URL("../migrations/0001_translation_budget.sql", import.meta.url), "utf8");
  await DB.exec(schema.replace(/^--.*$/gm, "").replace(/\s+/g, " "));
  const env = { DB, ACCESS_TOKEN: "synthetic-local-token-with-over-32-characters",
    AZURE_TRANSLATOR_KEY: "synthetic-not-a-secret", AZURE_TRANSLATOR_REGION: "eastasia",
    AZURE_TIER_CONFIRMED: "F0", MONTHLY_CHARACTER_BUDGET: "1000000", REQUESTS_PER_MINUTE: "6" };
  let calls = 0;
  const worker = createWorker({ now: () => new Date("2026-11-06T01:00:00Z"),
    fetcher: async (_url, init) => {
      calls++;
      const html = JSON.parse(init.body)[0].Text.replace("学习", "Learn");
      return Response.json([{ translations: [{ to: "en", text: html }] }]);
    } });
  const send = (overrides = {}) => worker.fetch(new Request("https://local.example/translate", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.ACCESS_TOKEN}` },
    body: JSON.stringify({ text: "学习 API", requestId: "550e8400-e29b-41d4-a716-446655440000" }),
  }), { ...env, ...overrides });
  const first = await send();
  assert.equal(first.status, 200);
  assert.equal((await first.json()).translation, "Learn API");
  const row = await DB.prepare("SELECT characters, requests FROM translation_budget").first();
  assert.ok(row.characters > 0);
  assert.equal(row.requests, 1);
  assert.equal((await (await send({ MONTHLY_CHARACTER_BUDGET: "1" })).json()).error.code, "QUOTA_EXCEEDED");
  assert.equal((await (await send({ REQUESTS_PER_MINUTE: "1" })).json()).error.code, "RATE_LIMITED");
  assert.equal((await (await send({ DB: undefined })).json()).error.code, "SERVICE_UNAVAILABLE");
  await DB.exec("DROP TABLE translation_budget");
  assert.equal((await (await send()).json()).error.code, "SERVICE_UNAVAILABLE");
  assert.equal(calls, 1);
  console.log("Local D1 binding: reservation, quota, rate, missing binding/schema verified; synthetic upstream calls=1; real Azure calls=0.");
} finally { await mf.dispose(); }
