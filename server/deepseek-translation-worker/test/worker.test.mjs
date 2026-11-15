import test from "node:test";
import assert from "node:assert/strict";
import { createWorker } from "../src/worker.mjs";
import { TRIAL_CASES, buildTrialRequest, prepareTrial, restoreTranslation, verifyTokenBound } from "../src/trial.mjs";
import { environment, request, proof, modelResponse, row } from "./support.mjs";

test("missing token proof: paid calls fail closed without reserving or fetching", async () => {
  const env = environment(); let calls = 0;
  try {
    const response = await createWorker({ tokenProof: null, fetcher: async () => { calls++; } }).fetch(request(TRIAL_CASES[0].text, env), env);
    assert.equal(response.status, 503); assert.equal(calls, 0); assert.equal(row(env).attempts, 0);
  } finally { env.DB.sqlite.close(); }
});

test("model/settings/prompt hashes are immutable approval bounds", async () => {
  const valid = await proof(), payload = JSON.stringify(buildTrialRequest(TRIAL_CASES[0].text));
  assert.equal(await verifyTokenBound(valid, 0, payload), true);
  for (const change of [
    { ...valid, model: "deepseek-v4-pro" }, { ...valid, maxInputTokens: 65536 },
    { ...valid, outputPricePerMillion: 7 }, { ...valid, tokenizerSha256: "0".repeat(64) },
    { ...valid, encoderSha256: "0".repeat(64) }, { ...valid, modelRepositoryCommit: "0".repeat(40) },
    { ...valid, cases: valid.cases.map((entry) => ({ ...entry, inputTokensUpperBound: 32769 })) },
  ]) assert.equal(await verifyTokenBound(change, 0, payload), false);
  assert.equal(await verifyTokenBound(valid, 0, payload.replace("natural English", "different prompt")), false);
  assert.throws(() => buildTrialRequest("任意文字"), /FIXED_TRIAL_TEXT_REQUIRED/);
});

test("token proof expires within 24 hours; future, expired, malformed or overlong windows fail closed", async () => {
  const valid = await proof(), payload = JSON.stringify(buildTrialRequest(TRIAL_CASES[0].text));
  const now = Date.parse(valid.reviewedAt);
  assert.equal(await verifyTokenBound(valid, 0, payload, now), true);
  assert.equal(await verifyTokenBound(valid, 0, payload, Date.parse(valid.expiresAt)), false);
  assert.equal(await verifyTokenBound(valid, 0, payload, now - 1), false);
  for (const changed of [
    { ...valid, expiresAt: new Date(now + 86400001).toISOString() },
    { ...valid, expiresAt: valid.reviewedAt }, { ...valid, reviewedAt: "not-an-ISO-date" },
    { ...valid, reviewedAt: undefined },
  ]) assert.equal(await verifyTokenBound(changed, 0, payload, now), false);
  const env = environment(); let calls = 0;
  try {
    const stale = { ...valid, reviewedAt: "2020-01-01T00:00:00.000Z", expiresAt: "2020-01-02T00:00:00.000Z" };
    assert.equal((await createWorker({ tokenProof: stale, fetcher: async () => { calls++; } }).fetch(request(TRIAL_CASES[0].text, env), env)).status, 503);
    assert.equal(calls, 0); assert.equal(row(env).attempts, 0);
  } finally { env.DB.sqlite.close(); }
});

test("authenticated four-sample contract, fixed official API, bounded non-thinking and byte-exact English", async () => {
  const env = environment(); let calls = 0;
  try {
    const worker = createWorker({ tokenProof: await proof(), fetcher: async (url, init) => {
      calls++; assert.equal(url, "https://api.deepseek.com/chat/completions"); assert.equal(init.redirect, "manual");
      const payload = JSON.parse(init.body), sample = TRIAL_CASES[calls - 1];
      assert.deepEqual(payload, buildTrialRequest(sample.text));
      assert.equal(payload.max_tokens, 512); assert.equal(payload.thinking.type, "disabled"); assert.equal(payload.stream, false);
      assert.ok(!("tools" in payload));
      return modelResponse("Translated " + prepareTrial(sample.text).fragments.map((fragment) => fragment.marker).join(" then "));
    } });
    for (const sample of TRIAL_CASES) {
      const response = await worker.fetch(request(sample.text, env), env);
      assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
      const body = await response.json(); assert.ok(body.requestId);
      for (const fragment of prepareTrial(sample.text).fragments) assert.ok(body.translation.includes(fragment.text));
    }
    assert.equal(calls, 4); assert.equal(row(env).reserved_micro_cny, 1000000);
    assert.equal((await worker.fetch(request(TRIAL_CASES[0].text, env), env)).status, 403);
    assert.equal(calls, 4);
  } finally { env.DB.sqlite.close(); }
});

test("pure English and code-point limit do not spend the trial; arbitrary Han and invalid input are refused", async () => {
  const env = environment(); let calls = 0;
  const worker = createWorker({ tokenProof: await proof(), fetcher: async () => { calls++; } });
  try {
    for (const text of ["I has a apple. NASA uses iPhone.", "😀".repeat(10000)]) {
      const response = await worker.fetch(request(text, env), env);
      assert.equal(response.status, 200); assert.equal((await response.json()).translation, text);
    }
    assert.equal((await worker.fetch(request("😀".repeat(10001), env), env)).status, 422);
    for (const text of ["任意文章不在试验中。", "  ", "文\ud800", "русский"]) {
      assert.equal((await worker.fetch(request(text, env), env)).status, 400);
    }
    assert.equal(calls, 0); assert.equal(row(env).attempts, 0);
  } finally { env.DB.sqlite.close(); }
});

test("closed/missing configuration, invalid credentials and missing DB cannot call upstream", async () => {
  const env = environment(); let calls = 0;
  const worker = createWorker({ tokenProof: await proof(), fetcher: async () => { calls++; } });
  try {
    for (const changed of [{ ...env, DEEPSEEK_TRIAL_ENABLED: "" }, { ...env, DB: null },
      { ...env, ACCESS_TOKEN: "short" }, { ...env, DEEPSEEK_API_KEY: "line\nbreak" }]) {
      assert.equal((await worker.fetch(request(TRIAL_CASES[0].text, env), changed)).status, 503);
    }
    const denied = request(TRIAL_CASES[0].text, env, crypto.randomUUID(), { headers: { "Content-Type": "application/json", Authorization: "Bearer wrong" } });
    assert.equal((await worker.fetch(denied, env)).status, 401); assert.equal(calls, 0); assert.equal(row(env).attempts, 0);
  } finally { env.DB.sqlite.close(); }
});

test("redirects reject before accessing response body or Location and never retry", async () => {
  for (const status of [300, 301, 302, 303, 307, 308, 399]) {
    const env = environment(); let calls = 0;
    try {
      const response = await createWorker({ tokenProof: await proof(), fetcher: async () => {
        calls++; return { status, get headers() { throw new Error("PRIVATE_LOCATION"); }, get body() { throw new Error("PRIVATE_BODY"); } };
      } }).fetch(request(TRIAL_CASES[0].text, env), env);
      assert.equal(response.status, 502); assert.equal(calls, 1); assert.equal(row(env).reserved_micro_cny, 250000);
      assert.ok(!(await response.text()).includes("PRIVATE"));
    } finally { env.DB.sqlite.close(); }
  }
});

test("every failed response is consumed once, with no refund or retry and no raw upstream leak", async () => {
  const responses = [
    () => new Response("PRIVATE_SECRET_BODY", { status: 401 }),
    () => modelResponse("ignored", (value) => { value.choices[0].finish_reason = "length"; return value; }),
    () => modelResponse("ignored", (value) => { value.choices[0].message.tool_calls = []; return value; }),
    () => modelResponse("ignored", (value) => { value.choices[0].message.reasoning_content = "PRIVATE"; return value; }),
    () => modelResponse("ignored", (value) => { value.usage.prompt_tokens = 32769; return value; }),
    () => Response.json({ choices: [] }),
    () => Response.json({ choices: [null] }),
    () => Response.json({ choices: [{ finish_reason: "stop", message: { role: "assistant", content: "PRIVATE_NOT_JSON" } }], usage: { prompt_tokens: 50, completion_tokens: 10 } }),
  ];
  for (const make of responses) {
    const env = environment(); let calls = 0;
    try {
      const worker = createWorker({ tokenProof: await proof(), fetcher: async () => { calls++; return make(); } });
      const response = await worker.fetch(request(TRIAL_CASES[0].text, env), env);
      assert.equal(response.status, 502); assert.ok(!(await response.text()).includes("PRIVATE"));
      assert.equal((await worker.fetch(request(TRIAL_CASES[0].text, env), env)).status, 403);
      assert.equal(calls, 1); assert.equal(row(env).reserved_micro_cny, 250000);
    } finally { env.DB.sqlite.close(); }
  }
});

test("missing schema blocks upstream and request timeout stops without retry", async () => {
  const env = environment(); let calls = 0;
  try {
    const worker = createWorker({ tokenProof: await proof(), fetcher: async () => { calls++; } });
    env.DB.sqlite.exec("DROP TABLE deepseek_trial_budget");
    assert.equal((await worker.fetch(request(TRIAL_CASES[0].text, env), env)).status, 503); assert.equal(calls, 0);
  } finally { env.DB.sqlite.close(); }
  const timeoutEnv = environment();
  try {
    const worker = createWorker({ tokenProof: await proof(), upstreamTimeoutMs: 10, fetcher: async (_url, init) => {
      calls++; await new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(new Error("PRIVATE_ABORT")), { once: true }));
    } });
    const response = await worker.fetch(request(TRIAL_CASES[0].text, timeoutEnv), timeoutEnv);
    assert.equal((await response.json()).error.code, "UPSTREAM_TIMEOUT"); assert.equal(calls, 1);
    assert.equal(row(timeoutEnv).reserved_micro_cny, 250000);
  } finally { timeoutEnv.DB.sqlite.close(); }
});

test("strict placeholder/schema restoration refuses altered, duplicated, unknown or missing English", () => {
  const { fragments } = prepareTrial(TRIAL_CASES[1].text), markers = fragments.map((entry) => entry.marker);
  assert.ok(restoreTranslation(JSON.stringify({ translation: markers.join(" ") }), fragments).includes("NASA API"));
  for (const translation of ["missing", markers.concat(markers[0]).join(" "), markers.join(" ") + " __BA_KEEP_99__", markers.join(" ") + " 未翻译"]) {
    assert.throws(() => restoreTranslation(JSON.stringify({ translation }), fragments));
  }
  for (const value of ["not JSON", JSON.stringify({ translation: "", other: "PRIVATE" }), JSON.stringify({ translation: "hello", extra: true })]) {
    assert.throws(() => restoreTranslation(value, []));
  }
  assert.equal(restoreTranslation('{"translation":"__BA_KEEP_0__"}', [{ marker: "__BA_KEEP_0__", text: "$& $` $'" }]), "$& $` $'");
});
