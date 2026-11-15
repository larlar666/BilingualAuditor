import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import { Worker } from "node:worker_threads";
import { DatabaseSync } from "node:sqlite";
import { spawnSync } from "node:child_process";
import { initializeLocalLedger, openLocalLedger } from "../tools/local-ledger.mjs";
import { runLocalTrial, checkLocalTrial } from "../tools/run-local-trial.mjs";
import { reserveTrial } from "../src/budget.mjs";
import { createWorker } from "../src/worker.mjs";
import { TRIAL_ID, LOCAL_AUTHORITY, TRIAL_CASES, prepareTrial } from "../src/trial.mjs";
import { environment, request, proof, row, modelResponse } from "./support.mjs";

const fixture = () => mkdtempSync(path.join(tmpdir(), "deepseek-local-trial-"));
const cleanup = (directory) => {
  assert.ok(path.dirname(directory) === tmpdir() && path.basename(directory).startsWith("deepseek-local-trial-"));
  rmSync(directory, { recursive: true, force: true });
};
const localProof = async () => ({ ...await proof(), executionAuthority: LOCAL_AUTHORITY });
const fileAt = (root) => path.join(root, ".local", `${TRIAL_ID}.sqlite`);
const markerAt = (root) => path.join(root, ".local", `${TRIAL_ID}.initialized.json`);
const successFetch = (_url, init) => {
  const payload = JSON.parse(init.body), data = JSON.parse(payload.messages[1].content);
  return modelResponse("A translated sample " + data.protectedEnglish.map((entry) => entry.marker).join(" then "));
};

test("local initialization is explicit; missing, partial and inconsistent ledgers cannot reset the fixed trial", async () => {
  const root = fixture();
  try {
    assert.throws(() => openLocalLedger(root));
    initializeLocalLedger(root);
    assert.throws(() => initializeLocalLedger(root));
    let db = openLocalLedger(root);
    const ledgerId = db.ledgerId;
    assert.equal(await reserveTrial(db, 0, crypto.randomUUID()), true);
    db.close(); db = openLocalLedger(root);
    assert.equal(db.ledgerId, ledgerId); assert.equal(db.snapshot().reservedMicroCny, 250000);
    assert.equal(await reserveTrial(db, 0, crypto.randomUUID()), false);
    db.close();
    const marker = JSON.parse(readFileSync(markerAt(root), "utf8"));
    writeFileSync(markerAt(root), JSON.stringify({ ...marker, ledgerId: crypto.randomUUID() }));
    assert.throws(() => openLocalLedger(root));
    writeFileSync(markerAt(root), JSON.stringify(marker));
    unlinkSync(fileAt(root));
    assert.throws(() => openLocalLedger(root)); assert.throws(() => initializeLocalLedger(root));
  } finally { cleanup(root); }
  for (const state of ["marker-only", "file-only", "initializing", "bad-row"]) {
    const partial = fixture();
    try {
      if (state === "bad-row") {
        initializeLocalLedger(partial);
        const sqlite = new DatabaseSync(fileAt(partial));
        sqlite.exec("UPDATE deepseek_trial_budget SET sample_mask=1"); sqlite.close();
      } else {
        mkdirSync(path.join(partial, ".local"));
        if (state !== "marker-only") writeFileSync(fileAt(partial), "");
        if (state !== "file-only") writeFileSync(markerAt(partial), JSON.stringify({ state: "initializing" }));
      }
      assert.throws(() => openLocalLedger(partial)); assert.throws(() => initializeLocalLedger(partial));
    } finally { cleanup(partial); }
  }
});

test("12 actual SQLite contenders share one ledger: max four unique claims, no UUID or restart reset", async () => {
  const root = fixture(); initializeLocalLedger(root); const threads = [];
  try {
    for (let i = 0; i < 12; i++) threads.push(new Worker(new URL("./local-budget-thread.mjs", import.meta.url), {
      workerData: { root, index: i % 4, id: crypto.randomUUID() },
    }));
    await Promise.all(threads.map((thread) => once(thread, "message")));
    const results = threads.map((thread) => once(thread, "message"));
    threads.forEach((thread) => thread.postMessage("go"));
    const values = (await Promise.all(results)).map(([value]) => value);
    assert.ok(values.every((value) => !value.error)); assert.equal(values.filter((value) => value.allowed).length, 4);
    const db = openLocalLedger(root);
    try { assert.deepEqual(db.snapshot(), { attempts: 4, reservedMicroCny: 1000000, sampleMask: 15, remainingCaseIds: [] }); }
    finally { db.close(); }
  } finally { await Promise.all(threads.map((thread) => thread.terminate())); cleanup(root); }
  const dedupe = fixture(); initializeLocalLedger(dedupe);
  try {
    const id = crypto.randomUUID(); let db = openLocalLedger(dedupe);
    assert.equal(await reserveTrial(db, 0, id), true); db.close(); db = openLocalLedger(dedupe);
    assert.equal(await reserveTrial(db, 1, id.toUpperCase()), false); assert.equal(db.snapshot().attempts, 1); db.close();
  } finally { cleanup(dedupe); }
});

test("default Worker and Cloudflare CLI reject local proof; request data, headers and env cannot change authority", async () => {
  const env = environment(), tokenProof = await localProof(); let calls = 0;
  try {
    const worker = createWorker({ tokenProof, fetcher: async () => { calls++; } });
    for (const override of [{}, { executionAuthority: LOCAL_AUTHORITY }]) {
      const incoming = request(TRIAL_CASES[0].text, env);
      const body = { ...await incoming.json(), ...override };
      const tampered = request(TRIAL_CASES[0].text, env, crypto.randomUUID(), {
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.ACCESS_TOKEN}`, executionAuthority: LOCAL_AUTHORITY },
        body: JSON.stringify(body),
      });
      const response = await worker.fetch(tampered, { ...env, executionAuthority: LOCAL_AUTHORITY });
      assert.equal(response.status, 503);
    }
    assert.equal(calls, 0); assert.equal(row(env).attempts, 0);
    const cli = spawnSync(process.execPath, ["tools/read-trial-contract.mjs", "--read"], {
      cwd: new URL("..", import.meta.url), encoding: "utf8", timeout: 10000,
    });
    assert.equal(cli.status, 1); assert.match(cli.stderr, /TRIAL_PROOF_GATE_FAILED/);
  } finally { env.DB.sqlite.close(); }
});

test("local runner uses existing handler, four fixed calls, byte exact fragments and persistent total across runs", async () => {
  const root = fixture(), tokenProof = await localProof(), events = []; let calls = 0;
  try {
    const checked = await checkLocalTrial({ root, proof: tokenProof, initialize: true });
    const args = { root, proof: tokenProof, proofSha256: checked.proofSha256, ledgerId: checked.ledgerId,
      apiKey: "synthetic-not-a-live-key", emit: (value) => events.push(value), fetcher: async (...params) => { calls++; return successFetch(...params); } };
    assert.equal(await runLocalTrial(args), true);
    assert.equal(calls, 4);
    const cases = events.filter((event) => event.event === "LOCAL_TRIAL_CASE");
    assert.equal(cases.length, 4);
    cases.forEach((event, i) => {
      assert.equal(event.status, 200); assert.equal(event.code, "OK"); assert.equal(event.upstreamStatus, 200);
      assert.deepEqual(event.usage, { promptTokens: 1000, completionTokens: 100 });
      assert.equal(event.estimatedPeakCostMicroCny, 2800);
      prepareTrial(TRIAL_CASES[i].text).fragments.forEach((fragment) => assert.ok(event.translation.includes(fragment.text)));
    });
    assert.equal(events.at(-1).event, "LOCAL_TRIAL_COMPLETE"); assert.equal(events.at(-1).reservedMicroCny, 1000000);
    assert.equal(await runLocalTrial(args), false); assert.equal(calls, 4);
    assert.equal(events.at(-1).reason, "QUOTA_EXCEEDED");
  } finally { cleanup(root); }
});

test("local runner stops after first error, reserves failed sample once and emits only safe upstream metadata", async () => {
  const root = fixture(), tokenProof = await localProof(), events = []; let calls = 0;
  try {
    const checked = await checkLocalTrial({ root, proof: tokenProof, initialize: true });
    assert.equal(await runLocalTrial({ root, proof: tokenProof, proofSha256: checked.proofSha256, ledgerId: checked.ledgerId,
      apiKey: "synthetic-not-a-live-key", emit: (value) => events.push(value), fetcher: async () => {
        calls++; return new Response("DO_NOT_LEAK_PRIVATE_OR_KEY", { status: 401 });
      } }), false);
    assert.equal(calls, 1); assert.equal(events[0].status, 502); assert.equal(events[0].upstreamStatus, 401);
    assert.equal(events.at(-1).attempts, 1); assert.equal(events.at(-1).reservedMicroCny, 250000);
    assert.ok(!JSON.stringify(events).includes("DO_NOT_LEAK"));
    const db = openLocalLedger(root); assert.equal(db.snapshot().sampleMask, 1); db.close();
  } finally { cleanup(root); }
});

test("bad Key, changed proof/ledger, expiry and cancellation all refuse before paid fetch", async () => {
  const root = fixture(), tokenProof = await localProof(), events = []; let calls = 0;
  try {
    const checked = await checkLocalTrial({ root, proof: tokenProof, initialize: true });
    const base = { root, proof: tokenProof, proofSha256: checked.proofSha256, ledgerId: checked.ledgerId,
      apiKey: "synthetic-not-a-live-key", emit: (value) => events.push(value), fetcher: async () => { calls++; } };
    const abort = new AbortController(); abort.abort();
    for (const change of [{ apiKey: "bad\nkey" }, { proofSha256: "0".repeat(64) }, { ledgerId: crypto.randomUUID() },
      { proof: { ...tokenProof, expiresAt: tokenProof.reviewedAt } }, { signal: abort.signal },
      { assertSourceUnchanged() { throw new Error("PRIVATE_CHANGED_FILE"); } }]) {
      assert.equal(await runLocalTrial({ ...base, ...change }), false);
    }
    assert.equal(calls, 0); const db = openLocalLedger(root); assert.equal(db.snapshot().attempts, 0); db.close();
    assert.ok(!JSON.stringify(events).includes("PRIVATE"));
  } finally { cleanup(root); }
});

test("proof or ledger changes between cases stop the run; aborting an active fetch cannot trigger another case", async () => {
  for (const kind of ["proof-change", "ledger-loss", "abort-fetch"]) {
    const root = fixture(), tokenProof = await localProof(), events = []; let calls = 0, changed = false;
    const controller = new AbortController();
    try {
      const checked = await checkLocalTrial({ root, proof: tokenProof, initialize: true });
      const result = await runLocalTrial({ root, proof: tokenProof, proofSha256: checked.proofSha256, ledgerId: checked.ledgerId,
        apiKey: "synthetic-not-a-live-key", signal: controller.signal, emit: (value) => events.push(value),
        assertSourceUnchanged() { if (changed) throw new Error("PRIVATE_SOURCE_CHANGE"); },
        fetcher: async (url, init) => {
          calls++;
          if (kind === "abort-fetch") {
            controller.abort();
            assert.equal(init.signal.aborted, true);
            throw new Error("PRIVATE_ABORTED_FETCH");
          }
          if (kind === "proof-change") changed = true;
          if (kind === "ledger-loss") unlinkSync(markerAt(root));
          return successFetch(url, init);
        } });
      assert.equal(result, false); assert.equal(calls, 1);
      assert.equal(events.at(-1).event, "LOCAL_TRIAL_STOPPED");
      assert.ok(!JSON.stringify(events).includes("PRIVATE"));
    } finally { cleanup(root); }
  }
});
