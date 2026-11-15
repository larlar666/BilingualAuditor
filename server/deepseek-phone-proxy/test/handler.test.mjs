import test from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "../src/contract.mjs";
import { preparePhone1000Text, buildPhoneRequest, restorePhoneTranslation } from "../src/phone-text.mjs";
import { checkPolicy, measurePayload, digest } from "../src/token-meter.mjs";
import { fixture, req, handler, model } from "./support.mjs";

test("code-point boundaries include emoji, whitespace and punctuation; protected English stays exact", () => {
  assert.equal([...('中' + '😀'.repeat(999))].length, 1000);
  preparePhone1000Text('中' + '😀'.repeat(999));
  assert.throws(() => preparePhone1000Text('中' + '😀'.repeat(1000)), /TEXT_TOO_LONG/);
  assert.throws(() => preparePhone1000Text('中文\ud800'), /INVALID_REQUEST/);
  assert.throws(() => preparePhone1000Text('中文__BA_KEEP_0__'), /PROTECTION_LIMIT/);
  assert.throws(() => preparePhone1000Text('中文<｜deepseek_image｜>'), /PROTECTION_LIMIT/);
  const p = preparePhone1000Text('今天用 NASA API 测试 I has a apple. 和 OpenAI。');
  assert.deepEqual(p.fragments.map((f) => f.text), ['NASA API', 'I has a apple.', 'OpenAI']);
  assert.equal(restorePhoneTranslation(JSON.stringify({ translation: 'Use  __BA_KEEP_0__  and __BA_KEEP_1__ with __BA_KEEP_2__.' }), p.fragments),
    'Use NASA API and I has a apple. with OpenAI.');
  for (const translation of ['Missing __BA_KEEP_0__', '__BA_KEEP_0__ __BA_KEEP_1__ __BA_KEEP_2__ __BA_KEEP_2__',
    '__BA_KEEP_0__ __BA_KEEP_1__ __BA_KEEP_99__']) assert.throws(() => restorePhoneTranslation(JSON.stringify({ translation }), p.fragments));
});
test("every actual dynamic payload uses official pinned full template and JSON-mode variant", async () => {
  const values = ['中文。', '中' + '😀'.repeat(999), '中英 A B NASA API https://example.com/Aa?x=One&b=2。',
    '汉A'.repeat(500), '汉' + '\u0000'.repeat(999)];
  for (const value of values) {
    const payload = JSON.stringify(buildPhoneRequest(preparePhone1000Text(value)));
    try {
      const measured = await measurePayload(payload);
      assert.equal(measured.payloadSha256, digest(payload));
      assert.ok(measured.officialTemplateTokens > 0);
      assert.ok(measured.officialTemplateWithResponseFormatTokens <= measured.inputTokensUpperBound);
      assert.ok(measured.inputTokensUpperBound <= 32768);
    } catch (error) {
      assert.ok(value === '汉A'.repeat(500), "only marker explosion may hit protection limit");
      assert.equal(error.code, 'PROTECTION_LIMIT');
    }
  }
  assert.throws(() => checkPolicy(Date.now() + 86400000), /SERVICE_UNAVAILABLE/);
  assert.throws(() => checkPolicy(0), /SERVICE_UNAVAILABLE/);
});
test("health and English cause zero model requests and reservations; local rejects precede meter", async () => {
  const f = fixture(); let db, calls = 0, meters = 0;
  try {
    f.initialize(); db = f.open(); const h = handler(db, { meter: async () => { meters++; throw new Error(); }, fetcher: async () => { calls++; return model(); } });
    assert.equal((await h.fetch(req('English I has a apple.'))).status, 200);
    const health = await (await h.fetch(req('', { method: 'GET', route: '/health' }))).json();
    assert.equal(health.translationReady, true); assert.equal(health.budget.attempts, 0);
    assert.equal((await h.fetch(req('', { method: 'GET', route: '/health', auth: 'wrong' }))).status, 401);
    assert.equal((await h.fetch(req('汉'.repeat(1001)))).status, 422);
    assert.equal((await h.fetch(req('', { raw: new Uint8Array([0xff]) }))).status, 400);
    assert.equal((await h.fetch(req('', { raw: 'x'.repeat(17000) }))).status, 400);
    assert.equal(meters, 0); assert.equal(calls, 0); assert.equal(db.snapshot().attempts, 0);
    h.clear();
  } finally { db?.close(); f.clean(); }
});
test("meter, expired policy and aborted input fail before reserve; duplicate UUID never resends", async () => {
  const f = fixture(); let db, calls = 0;
  try {
    f.initialize(); db = f.open();
    let h = handler(db, { meter: async () => { throw new ApiError('PROTECTION_LIMIT', 422); } });
    assert.equal((await h.fetch(req())).status, 422); assert.equal(db.snapshot().attempts, 0);
    h = handler(db, { policy: () => { throw new Error(); } });
    assert.equal((await h.fetch(req())).status, 503); assert.equal(db.snapshot().attempts, 0);
    h = handler(db, { fetcher: async () => { calls++; throw new Error('synthetic-no-log'); } });
    const request = req(); assert.equal((await h.fetch(request.clone())).status, 502);
    assert.equal((await h.fetch(request.clone())).status, 403);
    assert.equal(calls, 1); assert.equal(db.snapshot().attempts, 1);
    const abort = new AbortController(); abort.abort();
    h = handler(db, { signal: abort.signal });
    assert.equal((await h.fetch(req())).status, 503); assert.equal(db.snapshot().attempts, 1);
  } finally { db?.close(); f.clean(); }
});
test("timeouts, redirect rejection, invalid usage/output and tools count without refund; no raw output in events", async () => {
  const f = fixture(); let db;
  try {
    f.initialize(); db = f.open(); const events = [];
    const cases = [
      async (_url, init) => { assert.equal(init.redirect, 'manual'); return new Response('', { status: 307, headers: { Location: 'https://other.invalid' } }); },
      async () => model('', {}),
      async () => model('English', { usage: { prompt_tokens: 32769, completion_tokens: 1 } }),
      async () => model('English', { usage: { prompt_tokens: 1, completion_tokens: 4097 } }),
      async () => model('English', { choices: [{ finish_reason: 'length', message: { role: 'assistant', content: '{}' } }] }),
      async () => model('English', { choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '{}', tool_calls: [] } }] }),
      async (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('synthetic')), { once: true })),
    ];
    for (const fetcher of cases) {
      const h = handler(db, { fetcher, emit: (event) => events.push(event), upstreamTimeoutMs: 15 });
      assert.equal((await h.fetch(req())).status, 502);
    }
    assert.equal(db.snapshot().attempts, cases.length);
    const serialized = JSON.stringify(events);
    assert.ok(!serialized.includes('今天') && !serialized.includes('synthetic') && !serialized.includes('translation'));
  } finally { db?.close(); f.clean(); }
});
test("one in-flight request, local throttle, valid usage and English restoration", async () => {
  const f = fixture(); let db, release;
  try {
    f.initialize(); db = f.open();
    const h = handler(db, { fetcher: async (_url, init) => {
      await new Promise((resolve) => { release = resolve; });
      const payload = JSON.parse(init.body), source = JSON.parse(payload.messages[1].content);
      return model('Use ' + source.protectedEnglish.map((f) => f.marker).join(' and ') + '.');
    } });
    const pending = h.fetch(req('请用 NASA API 和 iPhone。'));
    while (!release) await new Promise((resolve) => setImmediate(resolve));
    assert.equal((await h.fetch(req())).status, 429); release();
    assert.equal((await (await pending).json()).translation, 'Use NASA API and iPhone.');
    const throttle = handler(db, { minimumIntervalMs: 10000 });
    assert.equal((await throttle.fetch(req())).status, 200); assert.equal((await throttle.fetch(req())).status, 429);
  } finally { db?.close(); f.clean(); }
});
