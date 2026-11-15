import test from "node:test";
import assert from "node:assert/strict";
import https from "node:https";
import { randomUUID, X509Certificate } from "node:crypto";
import { once, EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { startPhoneProxy, isPrivateIPv4 } from "../src/server.mjs";
import { checkPolicy, digest } from "../src/token-meter.mjs";
import { serve, checkPhoneProxy } from "../tools/run-phone-proxy.mjs";
import { fixture, certificate, key, token, fakeMeter, model } from "./support.mjs";

const inputFor = (cert, ledgerId) => ({ event: 'START_PHONE_PROXY', apiKey: key, accessToken: token,
  bindAddress: '127.0.0.1', allowedClientAddress: '127.0.0.1', port: 0, ...cert,
  policySha256: checkPolicy().policySha256, ledgerId });
function connect(proxy, cert, { method = 'GET', route = '/health', auth = token, body } = {}) {
  return new Promise((resolve, reject) => {
    const request = https.request({ hostname: '127.0.0.1', port: proxy.ready.port, path: route, method,
      ca: cert.certificatePem, rejectUnauthorized: true, agent: false,
      headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' } }, (response) => {
      const chunks = []; response.on('data', (value) => chunks.push(value));
      response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(chunks)) }));
    });
    request.on('error', reject); request.end(body);
  });
}
test('production bind is explicit private IPv4; no wildcard, public or loopback override from input', async () => {
  assert.equal(isPrivateIPv4('10.251.239.59'), true); assert.equal(isPrivateIPv4('10.251.239.220'), true);
  for (const address of ['0.0.0.0', '127.0.0.1', '8.8.8.8', '::1', '192.168.1.255']) assert.equal(isPrivateIPv4(address), false);
  const f = fixture();
  try { const id = f.initialize(); await assert.rejects(startPhoneProxy(inputFor({}, id))); }
  finally { f.clean(); }
});
test('local TLS pinned certificate, normal request completion, auth health and strict UTF8; zero real API', async () => {
  const f = fixture(), cert = certificate(), events = []; let proxy, calls = 0;
  try {
    const ledgerId = f.initialize();
    proxy = await startPhoneProxy(inputFor(cert, ledgerId), { root: f.root, testLoopback: true, meter: fakeMeter, minimumIntervalMs: 0,
      fetcher: async (_url, init) => { calls++; assert.equal(init.signal.aborted, false); return model(); }, emit: (value) => events.push(value) });
    assert.equal(proxy.ready.certificateSha256, digest(new X509Certificate(cert.certificatePem).raw));
    assert.ok(proxy.ready.endpoint.endsWith('/translate'));
    assert.equal((await connect(proxy, cert, { auth: 'wrong' })).status, 401);
    assert.equal((await connect(proxy, cert)).body.budget.attempts, 0);
    assert.equal(calls, 0);
    assert.equal((await connect(proxy, cert, { method: 'POST', route: '/translate', body: JSON.stringify({ text: '中文。', requestId: randomUUID() }) })).status, 200);
    assert.equal(calls, 1);
    assert.equal((await connect(proxy, cert, { method: 'POST', route: '/translate', body: Buffer.from([0xff]) })).status, 400);
    assert.equal((await connect(proxy, cert, { method: 'POST', route: '/translate', body: 'x'.repeat(17000) })).status, 400);
    await proxy.stop(); assert.equal(proxy.server.listening, false);
    assert.equal(events.at(-1).reason, 'USER_STOP');
    assert.ok(!JSON.stringify(events).includes(key) && !JSON.stringify(events).includes(token) && !JSON.stringify(events).includes('中文'));
  } finally { await proxy?.stop(); f.clean(); }
});
test('phone disconnect aborts one reserved upstream; shutdown closes listener and sockets', async () => {
  const f = fixture(), cert = certificate(); let proxy, upstreamSignal, entered;
  const started = new Promise((resolve) => { entered = resolve; });
  try {
    const ledgerId = f.initialize();
    proxy = await startPhoneProxy(inputFor(cert, ledgerId), { root: f.root, testLoopback: true, meter: fakeMeter,
      fetcher: async (_url, init) => { upstreamSignal = init.signal; entered(); return new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new Error('offline-disconnect')), { once: true });
      }); } });
    const request = https.request({ hostname: '127.0.0.1', port: proxy.ready.port, path: '/translate', method: 'POST',
      ca: cert.certificatePem, agent: false, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } });
    request.on('error', () => {}); request.end(JSON.stringify({ text: '中文。', requestId: randomUUID() }));
    await started; const aborted = once(upstreamSignal, 'abort'); request.destroy(); await aborted;
    assert.equal(upstreamSignal.aborted, true);
    const db = f.open(); assert.equal(db.snapshot().attempts, 1); db.close();
    await proxy.stop(); assert.equal(proxy.server.listening, false);
  } finally { await proxy?.stop(); f.clean(); }
});
test('source IP filter rejects another client before health or provider calls', async () => {
  const f = fixture(), cert = certificate(); let proxy;
  try {
    const input = inputFor(cert, f.initialize()); input.allowedClientAddress = '10.0.0.2';
    proxy = await startPhoneProxy(input, { root: f.root, testLoopback: true, meter: fakeMeter,
      fetcher: async () => { throw new Error('MUST_NOT_CALL'); } });
    await assert.rejects(connect(proxy, cert));
    const db = f.open(); assert.equal(db.snapshot().attempts, 0); db.close();
  } finally { await proxy?.stop(); f.clean(); }
});
test('session expiry aborts active fake upstream and closes TLS listener without refund', async () => {
  const f = fixture(), cert = certificate(); let proxy, signal, begin;
  const started = new Promise((resolve) => { begin = resolve; });
  const stopped = [];
  try {
    proxy = await startPhoneProxy(inputFor(cert, f.initialize()), { root: f.root, testLoopback: true, meter: fakeMeter,
      sessionMs: 150, emit: (event) => stopped.push(event),
      fetcher: async (_url, init) => { signal = init.signal; begin(); return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('offline-expiry')), { once: true });
      }); } });
    const pending = connect(proxy, cert, { method: 'POST', route: '/translate', body: JSON.stringify({ text: '中文。', requestId: randomUUID() }) });
    const result = pending.catch(() => null); await started;
    await result;
    assert.equal(signal.aborted, true); assert.equal(proxy.server.listening, false);
    assert.equal(stopped.at(-1).reason, 'SESSION_EXPIRED');
    const db = f.open(); assert.equal(db.snapshot().attempts, 1); db.close();
  } finally { await proxy?.stop(); f.clean(); }
});
test('CLI check uses isolated explicit ledger, unchanged policy, safe aggregate schema', async () => {
  const f = fixture();
  try {
    const check = await checkPhoneProxy({ root: f.root, initialize: true });
    assert.deepEqual(Object.keys(check).sort(), ['event','policySha256','policyExpiresAt','ledgerId','ledgerInitialized','limits','budget'].sort());
    assert.equal(check.ledgerInitialized, true); assert.equal(check.budget.attempts, 0);
    const again = await checkPhoneProxy({ root: f.root });
    assert.equal(again.ledgerId, check.ledgerId); assert.equal(again.ledgerInitialized, false);
  } finally { f.clean(); }
});
test('control input STOP, EOF and signals stop child service with safe enum; no background lifetime', async () => {
  for (const mode of ['STOP', 'EOF', 'SIGINT', 'BAD', 'INVALID_UTF8']) {
    const f = fixture(), stdin = new PassThrough(), events = new EventEmitter();
    let options, stopReason, capture = '', notify;
    const ready = new Promise((resolve) => { notify = resolve; });
    try {
      f.initialize();
      const running = serve({ root: f.root, stdin, events, stdout: new Writable({ write(chunk, _encoding, cb) { capture += chunk; cb(); } }),
        start: async (_input, supplied) => { options = supplied; notify(); return { stop: async (reason) => {
          stopReason = reason; options.emit({ event: 'PHONE_PROXY_STOPPED', reason });
        } }; } });
      stdin.write(JSON.stringify({ event: 'START_PHONE_PROXY' }) + '\n'); await ready;
      await new Promise((resolve) => setImmediate(resolve));
      if (mode === 'STOP') stdin.write('{"event":"STOP_PHONE_PROXY"}\n');
      if (mode === 'EOF') stdin.end();
      if (mode === 'SIGINT') events.emit('SIGINT');
      if (mode === 'BAD') stdin.write('{"event":"OTHER"}\n');
      if (mode === 'INVALID_UTF8') stdin.write(Buffer.from([0xff]));
      await running;
      assert.equal(stopReason, { STOP: 'USER_STOP', EOF: 'PARENT_EOF', SIGINT: 'INTERRUPTED', BAD: 'INPUT_INVALID', INVALID_UTF8: 'INPUT_INVALID' }[mode]);
      assert.equal(JSON.parse(capture.trim()).event, 'PHONE_PROXY_STOPPED');
      process.exitCode = 0;
    } finally { stdin.destroy(); f.clean(); }
  }
});
