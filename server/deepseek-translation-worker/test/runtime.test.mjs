// Pinned real workerd, production default fetcher, real local D1, fake outbound service only.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { TRIAL_CASES, prepareTrial } from "../src/trial.mjs";
import { proof, schema } from "./support.mjs";

test("real workerd constructs the production request; local D1 charges once and redirects never reach their target", async () => {
  // Reuse the already pinned project devtool; do not add/upgrade a runtime dependency.
  const require = createRequire(new URL("../../translation-worker/package.json", import.meta.url));
  const wranglerRequire = createRequire(require.resolve("wrangler/package.json"));
  const { Miniflare, convertV4MiniflareOptions } = await import(pathToFileURL(wranglerRequire.resolve("miniflare")).href);
  const root = fileURLToPath(new URL("..", import.meta.url));
  const manifest = await proof();
  const harness = `
import { createWorker } from "./src/worker.mjs";
const worker = createWorker({ tokenProof: ${JSON.stringify(manifest)} });
export default { async fetch(incoming, bindings) {
  const env = { ...bindings, ACCESS_TOKEN: "synthetic-runtime-personal-token-over-32-characters",
    DEEPSEEK_API_KEY: "synthetic-not-a-service-key", DEEPSEEK_TRIAL_ENABLED: "CNY1_FOUR_FIXED_CASES_V1" };
  return worker.fetch(new Request("https://local.invalid/translate", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + env.ACCESS_TOKEN },
    body: await incoming.text(),
  }), env);
} };
`;
  const modules = [{ type: "ESModule", path: "runtime-harness.mjs", contents: harness }];
  for (const name of ["worker", "budget", "trial", "token-bound-manifest"]) modules.push({
    type: "ESModule", path: `src/${name}.mjs`, contents: await readFile(new URL(`../src/${name}.mjs`, import.meta.url), "utf8"),
  });
  let status = 200, upstreamCalls = 0, redirectTargetCalls = 0;
  const mf = new Miniflare(convertV4MiniflareOptions({
    rootPath: root, modulesRoot: root, modules, compatibilityDate: "2026-11-06", d1Databases: { DB: "deepseek-trial-local-only" },
    outboundService: async (outgoing) => {
      if (outgoing.url !== "https://api.deepseek.com/chat/completions") {
        redirectTargetCalls++; return new Response("blocked target", { status: 500 });
      }
      upstreamCalls++;
      if (status !== 200) return new Response("PRIVATE_RESPONSE", { status, headers: { Location: "https://redirect-target.invalid/PRIVATE" } });
      const payload = await outgoing.json();
      assert.equal(payload.max_tokens, 512); assert.equal(payload.thinking.type, "disabled"); assert.equal(payload.stream, false);
      return Response.json({ choices: [{ finish_reason: "stop", message: { role: "assistant", content: '{"translation":"A sunny day."}' } }],
        usage: { prompt_tokens: 1000, completion_tokens: 20 } });
    },
  }));
  try {
    const db = await mf.getD1Database("DB");
    for (const statement of schema.split(";").map((part) => part.trim()).filter(Boolean)) await db.prepare(statement).run();
    const dispatch = (sample) => mf.dispatchFetch("http://local.invalid/", {
      method: "POST", body: JSON.stringify({ text: sample.text, requestId: crypto.randomUUID() }),
    });
    const good = await dispatch(TRIAL_CASES[0]);
    assert.equal(good.status, 200); assert.equal((await good.json()).translation, "A sunny day.");
    status = 302;
    const redirected = await dispatch(TRIAL_CASES[1]);
    assert.equal(redirected.status, 502); assert.ok(!(await redirected.text()).includes("PRIVATE"));
    assert.equal((await dispatch(TRIAL_CASES[1])).status, 403);
    assert.equal(upstreamCalls, 2); assert.equal(redirectTargetCalls, 0);
    const row = await db.prepare("SELECT reserved_micro_cny, attempts FROM deepseek_trial_budget").first();
    assert.equal(row.reserved_micro_cny, 500000); assert.equal(row.attempts, 2);
    assert.equal(prepareTrial(TRIAL_CASES[1].text).fragments.length, 3);
  } finally { await mf.dispose(); }
});
