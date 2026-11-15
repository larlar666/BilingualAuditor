import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CLOUDFLARE_AUTHORITY, LOCAL_AUTHORITY } from "../src/trial.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const fail = (condition) => { if (!condition) throw new Error("TRIAL_PROOF_GATE_FAILED"); };
const hash = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value) && !/^0+$/.test(value);
const modelCommit = "08c8657f02291e11b6f6b63e0e16014f8e748518";
const artifactRoot = `https://huggingface.co/deepseek-ai/DeepSeek-V4.1-Flash-1017/resolve/${modelCommit}/`;
const tokenizerHash = "c90dfa01249db1be4245780a052ede752e1361c612ac6d08e2bdada7d599476b";
const encoderHash = "13231c592e958fb39e2af6001dae69d90e7a36b265702b9b390236fb387599e2";
function utcTime(value) {
  fail(typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value));
  const milliseconds = Date.parse(value);
  fail(Number.isFinite(milliseconds));
  const canonical = new Date(milliseconds).toISOString();
  fail(canonical === value || canonical.replace(".000Z", "Z") === value);
  return milliseconds;
}

// This validates a separately reviewed offline proof; it never manufactures one.
export function verifyTrialProof(proof, cases, payloads, executionAuthority = CLOUDFLARE_AUTHORITY) {
  fail(proof?.schema === "deepseek-token-proof-v1" && proof.trialId === "deepseek-official-translation-trial-v1" && proof.status === "verified");
  fail([CLOUDFLARE_AUTHORITY, LOCAL_AUTHORITY].includes(executionAuthority) && proof.executionAuthority === executionAuthority);
  const reviewed = utcTime(proof.reviewedAt), expires = utcTime(proof.expiresAt), now = Date.now();
  fail(reviewed <= now && expires > now && expires > reviewed && expires - reviewed <= 86400000);
  fail(proof.model === "deepseek-flash" && proof.currency === "CNY");
  fail(proof.verifiedWithOfficialChatTemplate === true);
  fail(proof.modelRepositoryCommit === modelCommit && proof.tokenizerUrl === `${artifactRoot}tokenizer.json`);
  fail(proof.encoderUrl === `${artifactRoot}encoding/encoding.py`);
  fail(hash(proof.tokenizerSha256) && hash(proof.encoderSha256));
  fail(proof.tokenizerSha256 === tokenizerHash && proof.encoderSha256 === encoderHash);
  fail(proof.maxInputTokens === 32768 && proof.maxOutputTokens === 512);
  fail(proof.inputPricePerMillion === 2 && proof.outputPricePerMillion === 8);
  fail(proof.reservationMicroCny === 250000 && proof.maxAttempts === 4 && proof.totalMicroCny === 1000000);
  fail(Array.isArray(cases) && cases.length === 4 && Array.isArray(payloads) && payloads.length === 4);
  fail(Array.isArray(proof.cases) && proof.cases.length === 4);
  const ids = new Set();
  const result = cases.map((entry, i) => {
    fail(entry && typeof entry.id === "string" && /^[a-z_]{1,24}$/.test(entry.id) && !ids.has(entry.id));
    ids.add(entry.id);
    fail(typeof entry.text === "string" && entry.text.length > 0 && Buffer.byteLength(entry.text, "utf8") <= 2000);
    const payload = payloads[i];
    fail(payload && Object.keys(payload).every((key) => ["model", "messages", "thinking", "stream", "max_tokens", "response_format"].includes(key)));
    fail(payload?.model === "deepseek-flash" && payload.thinking?.type === "disabled" && payload.stream === false && payload.max_tokens === 512);
    fail(Object.keys(payload.thinking).length === 1);
    fail(payload.response_format?.type === "json_object" && Object.keys(payload.response_format).length === 1);
    fail(!Object.hasOwn(payload, "tools") && !Object.hasOwn(payload, "tool_choice"));
    fail(Array.isArray(payload.messages) && payload.messages.length === 2);
    fail(payload.messages[0]?.role === "system" && payload.messages[1]?.role === "user");
    fail(payload.messages.every((m) => Object.keys(m).length === 2 && typeof m.content === "string"));
    const requestHash = sha256(JSON.stringify(payload));
    const item = proof.cases.find((p) => p?.id === entry.id);
    fail(item && proof.cases.filter((p) => p?.id === entry.id).length === 1);
    fail(item.payloadSha256 === requestHash);
    // Includes the verified official chat template AND any API framing allowance.
    fail(Number.isInteger(item.inputTokensUpperBound) && item.inputTokensUpperBound > 0 && item.inputTokensUpperBound <= 32768);
    const microCny = Math.ceil((item.inputTokensUpperBound * 2000000 + 512 * 8000000) / 1000000);
    fail(microCny <= 250000);
    return { id: entry.id, text: entry.text, requestSha256: requestHash };
  });
  return { cases: result, maxAttempts: 4, totalMicroCny: 1000000, reservationMicroCny: 250000 };
}

async function readContract() {
  const module = await import(pathToFileURL(path.join(root, "src", "trial.mjs")).href);
  fail(Array.isArray(module.TRIAL_CASES) && typeof module.buildTrialRequest === "function" && typeof module.verifyTokenBound === "function");
  fail(module.TRIAL_ID === "deepseek-official-translation-trial-v1" && module.TRIAL_ENABLE_VALUE === "CNY1_FOUR_FIXED_CASES_V1");
  // The same canonical module is imported by the Worker. No second proof file exists.
  const proofModule = await import(pathToFileURL(path.join(root, "src", "token-bound-manifest.mjs")).href);
  const proof = proofModule.TOKEN_BOUND_MANIFEST;
  const bytes = Buffer.from(JSON.stringify(proof), "utf8");
  fail(bytes.length <= 65536);
  const payloads = module.TRIAL_CASES.map((entry) => module.buildTrialRequest(entry.text));
  const checked = verifyTrialProof(proof, module.TRIAL_CASES, payloads);
  for (let i = 0; i < payloads.length; i++) fail(await module.verifyTokenBound(proof, i, JSON.stringify(payloads[i])));
  return { ...checked, proofSha256: sha256(bytes) };
}

function selfTest() {
  const cases = ["chinese", "mixed", "spelling", "literal"].map((id) => ({ id, text: `合成 ${id}` }));
  const payloads = cases.map(({ text }) => ({ model: "deepseek-flash", messages: [{ role: "system", content: "Translate synthetic text." }, { role: "user", content: text }], thinking: { type: "disabled" }, stream: false, max_tokens: 512, response_format: { type: "json_object" } }));
  const proof = {
    schema: "deepseek-token-proof-v1", trialId: "deepseek-official-translation-trial-v1", status: "verified", executionAuthority: CLOUDFLARE_AUTHORITY, model: "deepseek-flash", currency: "CNY",
    reviewedAt: new Date(Date.now() - 60000).toISOString(), expiresAt: new Date(Date.now() + 3600000).toISOString(),
    verifiedWithOfficialChatTemplate: true, modelRepositoryCommit: modelCommit, tokenizerUrl: `${artifactRoot}tokenizer.json`, encoderUrl: `${artifactRoot}encoding/encoding.py`, tokenizerSha256: tokenizerHash, encoderSha256: encoderHash,
    maxInputTokens: 32768, maxOutputTokens: 512, inputPricePerMillion: 2, outputPricePerMillion: 8,
    reservationMicroCny: 250000, maxAttempts: 4, totalMicroCny: 1000000,
    cases: cases.map((entry, i) => ({ id: entry.id, payloadSha256: sha256(JSON.stringify(payloads[i])), inputTokensUpperBound: 32768 })),
  };
  verifyTrialProof(proof, cases, payloads);
  for (const mutate of [
    (p) => { p.verifiedWithOfficialChatTemplate = false; },
    (p) => { p.cases[0].inputTokensUpperBound = 32769; },
    (p) => { p.cases[0].payloadSha256 = "c".repeat(64); },
    (p) => { p.totalMicroCny = 1000001; },
    (p) => { p.maxAttempts = 5; },
    (p) => { p.inputPricePerMillion = 1; },
    (p) => { p.status = "unverified"; },
    (p) => { p.executionAuthority = LOCAL_AUTHORITY; },
    (p) => { p.modelRepositoryCommit = "main"; },
    (p) => { p.tokenizerUrl = "https://cdn.deepseek.com/api-docs/deepseek_v4_tokenizer.zip"; },
    (p) => { p.tokenizerSha256 = "a".repeat(64); },
    (p) => { p.encoderSha256 = "b".repeat(64); },
    (p) => { p.reviewedAt = new Date(Date.now() + 60000).toISOString(); },
    (p) => { p.reviewedAt = new Date(Date.now() - 7200000).toISOString(); p.expiresAt = new Date(Date.now() - 3600000).toISOString(); },
    (p) => { p.expiresAt = new Date(Date.now() + 90000000).toISOString(); },
    (p) => { p.expiresAt = "2026-02-30T00:00:00Z"; },
  ]) {
    const copy = structuredClone(proof); mutate(copy); let rejected = false;
    try { verifyTrialProof(copy, cases, payloads); } catch { rejected = true; }
    fail(rejected);
  }
  let missingRejected = false;
  try { verifyTrialProof(null, cases, payloads); } catch { missingRejected = true; }
  fail(missingRejected);
  console.log("TRIAL_PROOF_SELFTEST_OK FIXED_COSTS HASH_MATCH FULL_TEMPLATE_REQUIRED MISSING_PROOF_REJECTED NO_REMOTE");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    fail(args.length === 1 && ["--read", "--self-test"].includes(args[0]));
    if (args[0] === "--self-test") selfTest();
    else console.log(JSON.stringify(await readContract()));
  } catch {
    console.error("TRIAL_PROOF_GATE_FAILED NO_SECRET_NO_REMOTE");
    process.exitCode = 1;
  }
}
