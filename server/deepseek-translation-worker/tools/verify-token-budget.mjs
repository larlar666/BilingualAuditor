import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TRIAL_CASES, buildTrialRequest, verifyTokenBound, MODEL_REPOSITORY_COMMIT,
  TOKENIZER_URL, ENCODER_URL, TOKENIZER_SHA256, ENCODER_SHA256, LOCAL_AUTHORITY } from "../src/trial.mjs";
import { verifyTrialProof } from "./read-trial-contract.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const fail = (condition) => { if (!condition) throw new Error("OFFLINE_TOKEN_PROOF_FAILED"); };
const args = process.argv.slice(2);
try {
  fail(args.length >= 2 && args[0] === "--asset-dir" && typeof args[1] === "string");
  // This trial has moved to the local ledger. A future cloud migration needs a new review.
  fail((args.length === 4 || args.length === 5) && args[2] === "--authority" && args[3] === LOCAL_AUTHORITY);
  fail(args.length === 4 || args[4] === "--write-manifest");
  const payloads = TRIAL_CASES.map((entry) => buildTrialRequest(entry.text));
  const entries = TRIAL_CASES.map((entry, index) => ({ id: entry.id, payloadJson: JSON.stringify(payloads[index]) }));
  const result = spawnSync("python", ["-I", "-B", path.join(root, "tools", "verify-token-budget.py"), "--asset-dir", path.resolve(args[1])], {
    input: JSON.stringify(entries), encoding: "utf8", shell: false, timeout: 30000, maxBuffer: 65536,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1", TOKENIZERS_PARALLELISM: "false" },
  });
  fail(result.status === 0);
  const counted = JSON.parse(result.stdout);
  fail(typeof counted.tokenizersVersion === "string" && Array.isArray(counted.cases) && counted.cases.length === 4);
  const reviewed = new Date();
  const proof = {
    schema: "deepseek-token-proof-v1", status: "verified", executionAuthority: LOCAL_AUTHORITY,
    reviewedAt: reviewed.toISOString(), expiresAt: new Date(reviewed.getTime() + 86400000).toISOString(),
    verifiedWithOfficialChatTemplate: true, modelRepositoryCommit: MODEL_REPOSITORY_COMMIT,
    tokenizerUrl: TOKENIZER_URL, encoderUrl: ENCODER_URL,
    tokenizerSha256: TOKENIZER_SHA256, encoderSha256: ENCODER_SHA256,
    trialId: "deepseek-official-translation-trial-v1", model: "deepseek-flash",
    maxInputTokens: 32768, maxOutputTokens: 512, currency: "CNY",
    inputPricePerMillion: 2, outputPricePerMillion: 8,
    reservationMicroCny: 250000, totalMicroCny: 1000000, maxAttempts: 4,
    tokenizersVersion: counted.tokenizersVersion,
    evidenceScope: "PINNED_PUBLIC_TEXT_TEMPLATE_AND_FIXED_PAYLOADS_NOT_A_HOSTED_BILLING_GUARANTEE",
    cases: counted.cases,
  };
  verifyTrialProof(proof, TRIAL_CASES, payloads, LOCAL_AUTHORITY);
  for (let index = 0; index < payloads.length; index++) {
    fail(await verifyTokenBound(proof, index, JSON.stringify(payloads[index]), Date.now(), LOCAL_AUTHORITY));
  }
  // Prove stale or altered payloads cannot inherit this verification.
  const stale = structuredClone(proof); stale.expiresAt = new Date(reviewed.getTime() - 1).toISOString();
  fail(!(await verifyTokenBound(stale, 0, JSON.stringify(payloads[0]), Date.now(), LOCAL_AUTHORITY)));
  fail(!(await verifyTokenBound(proof, 0, JSON.stringify({ ...payloads[0], max_tokens: 513 }), Date.now(), LOCAL_AUTHORITY)));
  if (args[4] === "--write-manifest") {
    const target = path.join(root, "src", "token-bound-manifest.mjs");
    fail(readFileSync(target, "utf8").includes("export const TOKEN_BOUND_MANIFEST ="));
    writeFileSync(target, "// Generated offline from pinned public assets; never API credentials.\n" +
      "// Review the evidence scope and expiry before enabling a paid trial.\n" +
      `export const TOKEN_BOUND_MANIFEST = ${JSON.stringify(proof, null, 2)};\n`, "utf8");
  }
  console.log(JSON.stringify({
    result: "OFFLINE_TOKEN_PROOF_OK", manifestWritten: args[4] === "--write-manifest", executionAuthority: LOCAL_AUTHORITY,
    reviewedAt: proof.reviewedAt, expiresAt: proof.expiresAt, tokenizersVersion: proof.tokenizersVersion,
    cases: proof.cases, maximumCnyPerAttempt: "0.069632", maximumCnyFourAttempts: "0.278528",
    externalNetworkCalls: 0, apiCalls: 0,
  }));
} catch {
  console.error("OFFLINE_TOKEN_PROOF_FAILED NO_API_NO_SECRET");
  process.exitCode = 1;
}
