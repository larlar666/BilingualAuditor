import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createWorker } from "../src/worker.mjs";
import { TOKEN_BOUND_MANIFEST } from "../src/token-bound-manifest.mjs";
import { TRIAL_CASES, LOCAL_AUTHORITY, TRIAL_ENABLE_VALUE, buildTrialRequest, verifyTokenBound } from "../src/trial.mjs";
import { verifyTrialProof } from "./read-trial-contract.mjs";
import { initializeLocalLedger, openLocalLedger, WORKER_DIRECTORY } from "./local-ledger.mjs";

const manifestPath = fileURLToPath(new URL("../src/token-bound-manifest.mjs", import.meta.url));
const sourceHash = () => createHash("sha256").update(readFileSync(manifestPath)).digest("hex");
const syntheticAuth = "synthetic-local-inprocess-auth-not-a-real-personal-credential";
const workerErrors = new Set(["INVALID_REQUEST", "TEXT_TOO_LONG", "UNAUTHORIZED", "QUOTA_EXCEEDED", "SERVICE_UNAVAILABLE",
  "UPSTREAM_TIMEOUT", "UPSTREAM_ERROR", "PRESERVATION_FAILED", "RATE_LIMITED"]);
const safeStatuses = new Set([200, 400, 401, 402, 403, 404, 408, 422, 429, 500, 502, 503, 504]);
const fail = (condition, reason = "LOCAL_GATE_FAILED") => { if (!condition) throw new Error(reason); };
const proofHash = (proof) => createHash("sha256").update(JSON.stringify(proof), "utf8").digest("hex");

export async function checkLocalProof(proof = TOKEN_BOUND_MANIFEST) {
  const payloads = TRIAL_CASES.map((entry) => buildTrialRequest(entry.text));
  verifyTrialProof(proof, TRIAL_CASES, payloads, LOCAL_AUTHORITY);
  for (let i = 0; i < payloads.length; i++) fail(await verifyTokenBound(proof, i, JSON.stringify(payloads[i]), Date.now(), LOCAL_AUTHORITY));
  return proofHash(proof);
}

export async function checkLocalTrial({ initialize = false, root = WORKER_DIRECTORY, proof = TOKEN_BOUND_MANIFEST } = {}) {
  const proofSha256 = await checkLocalProof(proof);
  if (initialize) initializeLocalLedger(root);
  const db = openLocalLedger(root);
  try {
    return { event: "LOCAL_TRIAL_CHECK_OK", executionAuthority: LOCAL_AUTHORITY, proofSha256, ledgerId: db.ledgerId,
      ...db.snapshot(), ledgerInitialized: initialize };
  } finally { db.close(); }
}

function keyIsValid(value) {
  if (typeof value !== "string" || !value || value.length > 512 || /[^\x21-\x7e]/.test(value)) return false;
  try { new Headers({ Authorization: `Bearer ${value}` }); return true; } catch { return false; }
}

// Pure function runner permits isolated fake-upstream tests. The CLI supplies no root/fetch override.
export async function runLocalTrial({ apiKey, proofSha256, ledgerId, root = WORKER_DIRECTORY, proof = TOKEN_BOUND_MANIFEST,
  fetcher = (...args) => fetch(...args), emit = (value) => console.log(JSON.stringify(value)), signal,
  assertSourceUnchanged = () => {} } = {}) {
  let db, upstreamAttempts = 0, activeEnv;
  const safeSummary = (event, reason) => ({ event, ...(reason ? { reason } : {}), upstreamAttempts,
    ...(db ? { ledgerId: db.ledgerId, ...db.snapshot() } : {}) });
  try {
    fail(keyIsValid(apiKey), "KEY_INPUT_INVALID");
    fail(proofSha256 === await checkLocalProof(proof));
    assertSourceUnchanged();
    db = openLocalLedger(root);
    fail(db.ledgerId === ledgerId);
    const remaining = db.snapshot().remainingCaseIds;
    fail(remaining.length > 0, "QUOTA_EXCEEDED");
    activeEnv = { DB: db, ACCESS_TOKEN: syntheticAuth, DEEPSEEK_API_KEY: apiKey, DEEPSEEK_TRIAL_ENABLED: TRIAL_ENABLE_VALUE };
    let usage, upstreamStatus;
    const worker = createWorker({ tokenProof: proof, executionAuthority: LOCAL_AUTHORITY, abortSignal: signal,
      fetcher: (...args) => { upstreamAttempts++; return fetcher(...args); },
      onValidatedUsage: (value) => { usage = value; },
      onUpstreamStatus: (value) => { upstreamStatus = safeStatuses.has(value) ? value : "OTHER"; },
    });
    for (const id of remaining) {
      fail(!signal?.aborted, "INTERRUPTED");
      assertSourceUnchanged();
      fail(proofSha256 === await checkLocalProof(proof));
      fail(db.ledgerId === ledgerId);
      const sample = TRIAL_CASES.find((entry) => entry.id === id);
      usage = undefined; upstreamStatus = "OTHER";
      const result = await worker.fetch(new Request("https://local-trial.invalid/translate", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${syntheticAuth}` },
        body: JSON.stringify({ text: sample.text, requestId: randomUUID() }),
      }), activeEnv);
      const data = await result.json();
      fail(Number.isInteger(result.status) && safeStatuses.has(result.status), "LOCAL_RESULT_INVALID");
      const event = { event: "LOCAL_TRIAL_CASE", caseId: id, status: result.status, upstreamStatus };
      if (result.status === 200) {
        fail(typeof data.translation === "string" && data.translation.length <= 16384 && usage &&
          Number.isInteger(usage.promptTokens) && usage.promptTokens > 0 && usage.promptTokens <= 32768 &&
          Number.isInteger(usage.completionTokens) && usage.completionTokens > 0 && usage.completionTokens <= 512,
        "LOCAL_RESULT_INVALID");
        Object.assign(event, { code: "OK", translation: data.translation, usage,
          estimatedPeakCostMicroCny: usage.promptTokens * 2 + usage.completionTokens * 8 });
        emit(event);
      } else {
        const code = workerErrors.has(data?.error?.code) ? data.error.code : "LOCAL_RESULT_INVALID";
        emit({ ...event, code });
        emit(safeSummary("LOCAL_TRIAL_STOPPED", signal?.aborted ? "INTERRUPTED" : code));
        return false;
      }
    }
    emit(safeSummary("LOCAL_TRIAL_COMPLETE"));
    return true;
  } catch (error) {
    const reasons = new Set(["KEY_INPUT_INVALID", "INTERRUPTED", "LOCAL_RESULT_INVALID", "QUOTA_EXCEEDED"]);
    const reason = reasons.has(error?.message) ? error.message : "LOCAL_GATE_FAILED";
    try { emit(safeSummary("LOCAL_TRIAL_STOPPED", reason)); }
    catch { emit({ event: "LOCAL_TRIAL_STOPPED", reason: "LOCAL_GATE_FAILED", upstreamAttempts }); }
    return false;
  } finally {
    if (activeEnv) { activeEnv.DEEPSEEK_API_KEY = ""; activeEnv.DEEPSEEK_TRIAL_ENABLED = ""; }
    apiKey = undefined;
    db?.close();
  }
}

async function readInput(stream) {
  const pieces = []; let total = 0;
  const timer = setTimeout(() => stream.destroy(new Error("INPUT_TIMEOUT")), 30000);
  try {
    for await (const piece of stream) {
      total += piece.length; fail(total <= 4096, "KEY_INPUT_INVALID"); pieces.push(piece);
    }
    const bytes = Buffer.concat(pieces); let value;
    try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
    catch { throw new Error("KEY_INPUT_INVALID"); }
    finally { bytes.fill(0); }
    fail(value && !Array.isArray(value) && Object.keys(value).sort().join(",") === "apiKey,ledgerId,proofSha256", "KEY_INPUT_INVALID");
    return value;
  } finally { clearTimeout(timer); pieces.forEach((piece) => piece.fill(0)); }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--self-test") {
    const result = spawnSync(process.execPath, ["--test", "test/local-trial.test.mjs"], {
      cwd: WORKER_DIRECTORY, encoding: "utf8", timeout: 30000, maxBuffer: 1048576,
    });
    fail(result.status === 0);
    console.log(JSON.stringify({ event: "LOCAL_TRIAL_SELFTEST_OK", externalNetworkCalls: 0 }));
    return;
  }
  fail(args.length >= 2 && ["--check", "--run"].includes(args[0]) && args[1] === "--cny-account-confirmed");
  const check = args[0] === "--check", initialize = args[2] === "--initialize-ledger";
  fail(args.length === 2 || (check && initialize && args.length === 3));
  if (check) {
    console.log(JSON.stringify(await checkLocalTrial({ initialize })));
    return;
  }
  const originalSourceHash = sourceHash();
  // Missing/expired proof or missing ledger fails before waiting for a Key.
  await checkLocalTrial();
  let input;
  const controller = new AbortController(), abort = () => controller.abort();
  process.on("SIGINT", abort); process.on("SIGTERM", abort);
  try {
    input = await readInput(process.stdin);
    const success = await runLocalTrial({ ...input, signal: controller.signal,
      assertSourceUnchanged: () => fail(sourceHash() === originalSourceHash) });
    process.exitCode = success ? 0 : 1;
  } finally {
    if (input) input.apiKey = undefined;
    process.off("SIGINT", abort); process.off("SIGTERM", abort);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(); }
  catch (error) {
    console.log(JSON.stringify({ event: "LOCAL_TRIAL_STOPPED",
      reason: error?.message === "INPUT_TIMEOUT" ? "INPUT_TIMEOUT" : "LOCAL_GATE_FAILED", upstreamAttempts: 0 }));
    process.exitCode = 1;
  }
}
