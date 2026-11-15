// Production handler in pinned workerd, with every outbound request handled locally.
// No account, real credentials, remote D1 or Azure connection is used.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const wranglerRequire = createRequire(require.resolve("wrangler/package.json"));
const { Miniflare, convertV4MiniflareOptions } = await import(pathToFileURL(wranglerRequire.resolve("miniflare")).href);
const root = fileURLToPath(new URL("..", import.meta.url));
const harness = `
import { createWorker } from "./src/worker.mjs";
const env = {
  ACCESS_TOKEN: "synthetic-local-token-with-over-32-characters",
  AZURE_TRANSLATOR_KEY: "synthetic-not-a-secret", AZURE_TRANSLATOR_REGION: "eastasia",
  AZURE_TIER_CONFIRMED: "F0", SAFE_UPSTREAM_DIAGNOSTICS: "SAFE_ENUMS_V1",
  MONTHLY_CHARACTER_BUDGET: "1000000", REQUESTS_PER_MINUTE: "6",
  // Budget storage is not under test here; the separate D1/SQLite tools cover it.
  DB: { prepare() { return { bind() { return {
    async run() { return { success: true, meta: { changes: 1 } }; },
  }; } }; } },
};
const worker = createWorker({ now: () => new Date("2026-11-06T01:00:00Z") });
export default { async fetch(incoming) {
  if (new URL(incoming.url).pathname === "/request-modes") {
    const modes = {};
    for (const redirect of ["error", "manual", "follow"]) {
      try { modes[redirect] = new Request("https://synthetic.invalid/", { redirect }).redirect; }
      catch (error) { modes[redirect] = error instanceof TypeError ? "TypeError" : "OTHER"; }
    }
    return Response.json(modes);
  }
  return worker.fetch(new Request("https://local.invalid/translate", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + env.ACCESS_TOKEN },
    body: JSON.stringify({ text: "学习 API", requestId: "550e8400-e29b-41d4-a716-446655440000" }),
  }), env);
} };
`;
const modules = [{ type: "ESModule", path: "transport-harness.mjs", contents: harness }];
for (const name of ["worker", "budget", "protection"]) {
  modules.push({ type: "ESModule", path: `src/${name}.mjs`,
    contents: await readFile(new URL(`../src/${name}.mjs`, import.meta.url), "utf8") });
}
let responseStatus = 200, upstreamCalls = 0, redirectTargetCalls = 0;
const mf = new Miniflare(convertV4MiniflareOptions({
  rootPath: root, modulesRoot: root, modules, compatibilityDate: "2026-11-06",
  // This function is the only outbound service: it never calls fetch or a socket.
  outboundService: async (request) => {
    if (new URL(request.url).hostname !== "api.cognitive.microsofttranslator.com") {
      redirectTargetCalls++;
      return new Response("blocked synthetic redirect target", { status: 500 });
    }
    upstreamCalls++;
    if (responseStatus !== 200) return new Response("PRIVATE_REDIRECT_BODY", {
      status: responseStatus, headers: { Location: "https://redirect-target.invalid/PRIVATE_LOCATION" },
    });
    const [{ Text }] = await request.json();
    return Response.json([{ translations: [{ to: "en", text: Text.replace("学习", "Learn") }] }]);
  },
}));
try {
  const modes = await (await mf.dispatchFetch("http://local.invalid/request-modes")).json();
  assert.deepEqual(modes, { error: "TypeError", manual: "manual", follow: "follow" });
  assert.equal(upstreamCalls, 0);
  const success = await mf.dispatchFetch("http://local.invalid/");
  assert.equal(success.status, 200);
  assert.equal((await success.json()).translation, "Learn API");
  assert.equal(upstreamCalls, 1);
  for (const status of [300, 301, 302, 303, 307, 308, 399]) {
    responseStatus = status;
    const before = upstreamCalls;
    const response = await mf.dispatchFetch("http://local.invalid/");
    const raw = await response.text();
    assert.equal(response.status, 502);
    assert.equal(JSON.parse(raw).error.code, "UPSTREAM_ERROR");
    assert.deepEqual(JSON.parse(raw).error.diagnostic,
      { stage: "http", httpStatus: "OTHER", azureCode: "OTHER" });
    assert.equal(upstreamCalls, before + 1);
    assert.equal(redirectTargetCalls, 0);
    assert.ok(!raw.includes("PRIVATE_"));
  }
  console.log("LOCAL_TRANSPORT_OK WORKERD_REQUEST_ERROR_REJECTED MANUAL_ACCEPTED HANDLER_200 REDIRECTS_7_REJECTED REDIRECT_TARGET_CALLS=0 EXTERNAL_NETWORK=0 REAL_AZURE=0");
} finally { await mf.dispose(); }
