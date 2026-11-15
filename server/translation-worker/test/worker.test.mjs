import test from "node:test";
import assert from "node:assert/strict";
import { createWorker } from "../src/worker.mjs";
import { environment, request } from "./support.mjs";

const now = () => new Date("2026-11-06T01:00:00.000Z");
function fakeTranslator(counter, change = (value) => value.replace("学习", "Learn")) {
  return async (url, init) => {
    counter.calls++;
    assert.equal(init.redirect, "manual");
    assert.ok(url.startsWith("https://api.cognitive.microsofttranslator.com/"));
    const text = JSON.parse(init.body)[0].Text;
    return Response.json([{ translations: [{ to: "en", text: change(text) }] }]);
  };
}

test("real request contract with synthetic upstream: preserved English and no-store", async () => {
  const env = environment(), count = { calls: 0 };
  const response = await createWorker({ fetcher: fakeTranslator(count), now }).fetch(request("学习 API 和 teh English。", env), env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  const body = await response.json();
  assert.equal(body.requestId, "550e8400-e29b-41d4-a716-446655440000");
  assert.ok(body.translation.includes("teh English。"));
  assert.equal(count.calls, 1);
  assert.ok(env.DB.sqlite.prepare("SELECT characters FROM translation_budget").get().characters > 20);
});

test("9999/10000 code points accepted, 10001 rejected; emoji is one product code point", async () => {
  const env = environment(), count = { calls: 0 };
  const worker = createWorker({ fetcher: fakeTranslator(count), now });
  for (const length of [9999, 10000]) {
    const response = await worker.fetch(request("😀".repeat(length), env), env);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).translation, "😀".repeat(length));
  }
  const response = await worker.fetch(request("😀".repeat(10001), env), env);
  assert.equal((await response.json()).error.code, "TEXT_TOO_LONG");
  assert.equal(count.calls, 0);
  assert.equal(env.DB.sqlite.prepare("SELECT count(*) AS n FROM translation_budget").get().n, 0);
});

test("blank, unsupported languages, malformed surrogate, unauthorized and missing F0 config never call upstream", async () => {
  const env = environment(), count = { calls: 0 };
  const worker = createWorker({ fetcher: fakeTranslator(count), now });
  for (const text of ["  ", "русский", "汉\ud800"]) {
    assert.equal((await (await worker.fetch(request(text, env), env)).json()).error.code, "INVALID_REQUEST");
  }
  const denied = request("学习", env, { headers: { "Content-Type": "application/json", Authorization: "Bearer wrong" } });
  assert.equal((await (await worker.fetch(denied, env)).json()).error.code, "UNAUTHORIZED");
  assert.equal((await (await worker.fetch(request("学习", env), { ...env, AZURE_TIER_CONFIRMED: "" })).json()).error.code, "SERVICE_UNAVAILABLE");
  assert.equal(count.calls, 0);
});

test("DB unavailable, exhausted monthly budget or rate blocks before upstream", async () => {
  const count = { calls: 0 }, worker = createWorker({ fetcher: fakeTranslator(count), now });
  const broken = environment({ prepare() { throw new Error("private database detail"); } });
  assert.equal((await (await worker.fetch(request("学习", broken), broken)).json()).error.code, "SERVICE_UNAVAILABLE");
  const env = environment();
  env.MONTHLY_CHARACTER_BUDGET = "1";
  assert.equal((await (await worker.fetch(request("学习", env), env)).json()).error.code, "QUOTA_EXCEEDED");
  env.MONTHLY_CHARACTER_BUDGET = "1000000";
  env.REQUESTS_PER_MINUTE = "1";
  assert.equal((await worker.fetch(request("学习", env), env)).status, 200);
  assert.equal((await (await worker.fetch(request("学习", env), env)).json()).error.code, "RATE_LIMITED");
  assert.equal(count.calls, 1);
});

test("upstream quota/rate/redirect failures and preservation mismatch are mapped without leaking body", async () => {
  for (const [status, upstreamCode, expected] of [[403, 403001, "QUOTA_EXCEEDED"], [429, 429000, "RATE_LIMITED"], [401, 401000, "UPSTREAM_ERROR"]]) {
    const env = environment();
    const worker = createWorker({ now, fetcher: async () => Response.json({ error: { code: upstreamCode, message: "DO_NOT_LEAK" } }, { status }) });
    const response = await worker.fetch(request("学习 API", env), env);
    const body = await response.text();
    assert.ok(body.includes(expected)); assert.ok(!body.includes("DO_NOT_LEAK"));
    assert.ok(env.DB.sqlite.prepare("SELECT characters FROM translation_budget").get().characters > 0);
  }
  const env = environment(), count = { calls: 0 };
  const worker = createWorker({ now, fetcher: fakeTranslator(count, (html) => html.replace("API", "Api")) });
  assert.equal((await (await worker.fetch(request("学习 API", env), env)).json()).error.code, "PRESERVATION_FAILED");
  const failed = createWorker({ now, fetcher: async () => { throw new Error("redirect rejected private URL"); } });
  assert.equal((await (await failed.fetch(request("学习", env), env)).json()).error.code, "UPSTREAM_ERROR");
});

test("upstream 3xx is rejected before reading body or Location and never retried", async () => {
  for (const status of [300, 301, 302, 303, 307, 308, 399]) {
    const env = environment();
    env.SAFE_UPSTREAM_DIAGNOSTICS = "SAFE_ENUMS_V1";
    let calls = 0, responseReads = 0;
    const worker = createWorker({ now, fetcher: async (_url, init) => {
      calls++;
      assert.equal(init.redirect, "manual");
      return { status,
        get headers() { responseReads++; throw new Error("PRIVATE_LOCATION"); },
        get body() { responseReads++; throw new Error("PRIVATE_BODY"); },
      };
    } });
    const response = await worker.fetch(request("学习 API", env), env);
    const raw = await response.text();
    assert.equal(response.status, 502);
    assert.equal(JSON.parse(raw).error.code, "UPSTREAM_ERROR");
    assert.deepEqual(JSON.parse(raw).error.diagnostic,
      { stage: "http", httpStatus: "OTHER", azureCode: "OTHER" });
    assert.equal(calls, 1);
    assert.equal(responseReads, 0);
    assert.ok(!raw.includes("PRIVATE_"));
    assert.ok(env.DB.sqlite.prepare("SELECT characters FROM translation_budget").get().characters > 0);
  }
});

test("body cap and invalid route are rejected, English remains original without upstream", async () => {
  const env = environment(), count = { calls: 0 }, worker = createWorker({ fetcher: fakeTranslator(count), now });
  const english = "teh English API HTTPS://EXAMPLE.COM?a=1&b=2 😀";
  assert.equal((await (await worker.fetch(request(english, env), env)).json()).translation, english);
  const large = request("学习", env, { body: "x".repeat(150001) });
  assert.equal((await (await worker.fetch(large, env)).json()).error.code, "INVALID_REQUEST");
  const route = new Request("http://translation.example/translate", { method: "POST" });
  assert.equal((await (await worker.fetch(route, env)).json()).error.code, "INVALID_REQUEST");
  assert.equal(count.calls, 0);
});

test("protection markup overflow is distinct from the product text limit, never truncated or sent", async () => {
  const env = environment(), count = { calls: 0 }, worker = createWorker({ fetcher: fakeTranslator(count), now });
  const text = "中a".repeat(4000);
  assert.ok([...text].length < 10000);
  const response = await worker.fetch(request(text, env), env);
  assert.equal((await response.json()).error.code, "PROTECTION_LIMIT");
  assert.equal(count.calls, 0);
});

test("upstream timeout aborts the pending call, retains its conservative reservation, and never retries", async () => {
  const env = environment();
  let calls = 0;
  const worker = createWorker({ now, upstreamTimeoutMs: 5, fetcher: async (_url, init) => {
    calls++;
    await new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
  } });
  const response = await worker.fetch(request("学习 API", env), env);
  assert.equal((await response.json()).error.code, "UPSTREAM_TIMEOUT");
  assert.equal(calls, 1);
  assert.ok(env.DB.sqlite.prepare("SELECT characters FROM translation_budget").get().characters > 0);
});

test("temporary authenticated diagnostics identify four stages using constants only", async () => {
  const privateValue = "DO_NOT_LEAK_PRIVATE_TEXT_KEY_HEADER";
  const samples = [
    ["transport", "OTHER", "OTHER", async () => { throw new Error(privateValue); }],
    ["response_decode", "401", "OTHER", async () => new Response(privateValue, { status: 401 })],
    ["http", "401", "401000", async () => Response.json({ error: { code: 401000, message: privateValue }, headers: privateValue }, { status: 401 })],
    ["response_shape", "200", "OTHER", async () => Response.json({ private: privateValue })],
    ["response_decode", "200", "OTHER", async () => new Response(new ReadableStream({ start(controller) { controller.error(new Error(privateValue)); } }))],
    ["http", "OTHER", "OTHER", async () => Response.json({ error: { code: privateValue, message: privateValue } }, { status: 418 })],
    ["http", "401", "OTHER", async () => Response.json({ error: { code: { toString: privateValue } } }, { status: 401 })],
  ];
  for (const [stage, httpStatus, azureCode, fetcher] of samples) {
    const env = environment();
    env.SAFE_UPSTREAM_DIAGNOSTICS = "SAFE_ENUMS_V1";
    let calls = 0;
    const worker = createWorker({ now, fetcher: async (...args) => { calls++; return fetcher(...args); } });
    const response = await worker.fetch(request("学习 API", env), env);
    const raw = await response.text();
    assert.equal(response.status, 502);
    assert.deepEqual(JSON.parse(raw).error.diagnostic, { stage, httpStatus, azureCode });
    assert.ok(!raw.includes(privateValue));
    assert.ok(!raw.includes(env.AZURE_TRANSLATOR_KEY));
    assert.ok(!raw.includes(env.ACCESS_TOKEN));
    assert.ok(!raw.includes("学习 API"));
    assert.equal(calls, 1);
    assert.ok(env.DB.sqlite.prepare("SELECT characters FROM translation_budget").get().characters > 0);
  }
});

test("diagnostics default closed, require exact flag, and never appear before authorization or upstream", async () => {
  for (const flag of [undefined, "", "true", "SAFE_ENUMS_V1 "]) {
    const env = environment();
    env.SAFE_UPSTREAM_DIAGNOSTICS = flag;
    const worker = createWorker({ now, fetcher: async () => Response.json({ error: { code: 401000 } }, { status: 401 }) });
    const body = await (await worker.fetch(request("学习", env), env)).json();
    assert.deepEqual(Object.keys(body.error).sort(), ["code", "message"]);
    assert.equal(body.error.code, "UPSTREAM_ERROR");
  }
  const env = environment();
  env.SAFE_UPSTREAM_DIAGNOSTICS = "SAFE_ENUMS_V1";
  let calls = 0;
  const worker = createWorker({ now, fetcher: async () => { calls++; throw new Error("must not call"); } });
  const unauthorized = request("学习", env, { headers: { "Content-Type": "application/json", Authorization: "Bearer wrong" } });
  for (const req of [unauthorized, request("中".repeat(10001), env)]) {
    const body = await (await worker.fetch(req, env)).json();
    assert.equal(body.error.diagnostic, undefined);
  }
  assert.equal(calls, 0);
});

test("diagnostic quota/rate mapping and timeout preserve existing error contracts", async () => {
  for (const [status, code, expected] of [[403, "403001", "QUOTA_EXCEEDED"], [429, 429000, "RATE_LIMITED"]]) {
    const env = environment(); env.SAFE_UPSTREAM_DIAGNOSTICS = "SAFE_ENUMS_V1";
    const worker = createWorker({ now, fetcher: async () => Response.json({ error: { code } }, { status }) });
    const response = await worker.fetch(request("学习", env), env);
    assert.equal(response.status, status);
    const body = await response.json();
    assert.equal(body.error.code, expected);
    assert.deepEqual(body.error.diagnostic, { stage: "http", httpStatus: String(status), azureCode: String(code) });
  }
  const env = environment(); env.SAFE_UPSTREAM_DIAGNOSTICS = "SAFE_ENUMS_V1";
  const worker = createWorker({ now, upstreamTimeoutMs: 5, fetcher: async (_url, init) => {
    await new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(new Error("PRIVATE_TIMEOUT")), { once: true }));
  } });
  const response = await worker.fetch(request("学习", env), env);
  const body = await response.json();
  assert.equal(body.error.code, "UPSTREAM_TIMEOUT");
  assert.deepEqual(body.error.diagnostic, { stage: "transport", httpStatus: "OTHER", azureCode: "OTHER" });
});
