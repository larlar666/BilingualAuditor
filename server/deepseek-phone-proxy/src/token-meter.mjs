import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ApiError, TRIAL_ID, AUTHORITY, MODEL, MAX_INPUT_TOKENS, MAX_OUTPUT_TOKENS, RESERVATION, LIMITS } from "./contract.mjs";
import { MODEL_REPOSITORY_COMMIT, TOKENIZER_SHA256, ENCODER_SHA256 } from "../../deepseek-translation-worker/src/trial.mjs";
export const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const policyFile = new URL("./policy-proof.json", import.meta.url);
const fixed = { schema: "deepseek-phone-policy-v1", trialId: TRIAL_ID, authority: AUTHORITY, model: MODEL,
  modelVersion: "DeepSeek-V4.1-Flash-1017", modelRepositoryCommit: MODEL_REPOSITORY_COMMIT,
  tokenizerSha256: TOKENIZER_SHA256, encoderSha256: ENCODER_SHA256, tokenizersVersion: "0.22.2", currency: "CNY",
  inputPricePerMillion: 2, outputPricePerMillion: 8, maxInputTokens: MAX_INPUT_TOKENS, maxOutputTokens: MAX_OUTPUT_TOKENS,
  reservationMicroCny: RESERVATION, maxAttempts: LIMITS.maxAttempts, totalMicroCny: LIMITS.maxBudgetMicroCny,
  pricingSource: "https://api-docs.deepseek.com/zh-cn/quick_start/pricing/",
  evidenceScope: "OFFICIAL_PINNED_TEXT_TEMPLATE_PER_ACTUAL_PAYLOAD_PLUS_JSON_FORMAT_VARIANT_NOT_HOSTED_BILLING_GUARANTEE" };
export function checkPolicy(now = Date.now()) {
  const bytes = readFileSync(policyFile), policy = JSON.parse(bytes);
  const from = Date.parse(policy.reviewedAt), until = Date.parse(policy.expiresAt);
  if (Object.keys(policy).length !== Object.keys(fixed).length + 2 ||
    Object.entries(fixed).some(([key, value]) => policy[key] !== value) ||
    !Number.isFinite(from) || !Number.isFinite(until) || from > now || until <= now || until <= from || until - from > 86400000 ||
    new Date(from).toISOString() !== policy.reviewedAt || new Date(until).toISOString() !== policy.expiresAt ||
    MAX_INPUT_TOKENS * 2 + MAX_OUTPUT_TOKENS * 8 >= RESERVATION) throw new ApiError("SERVICE_UNAVAILABLE");
  return { policySha256: digest(bytes), policyExpiresAt: policy.expiresAt };
}

// No key or source text in argv, environment, files or output. The audited public
// encoder sees only stdin. Parent consumes only a digest and bounded integers.
export async function measurePayload(payloadJson, { signal, timeoutMs = 10000 } = {}) {
  if (Buffer.byteLength(payloadJson) > 65536) throw new ApiError("PROTECTION_LIMIT", 422);
  const env = {};
  for (const key of ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "LOCALAPPDATA", "USERPROFILE"]) {
    if (process.env[key]) env[key] = process.env[key];
  }
  const result = await new Promise((resolve, reject) => {
    const child = spawn("python", ["-I", "-B", fileURLToPath(new URL("../tools/count-phone-tokens.py", import.meta.url)),
      "--asset-dir", path.join(homedir(), "AppData", "Local", "Temp", "bilingual-deepseek-tokenizer-audit")],
    { shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"], env });
    let output = "", bytes = 0, settled = false;
    const finish = (error, value) => {
      if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener("abort", abort);
      error ? reject(new ApiError("PROTECTION_LIMIT", 422)) : resolve(value);
    };
    const abort = () => { child.kill(); finish(true); };
    const timer = setTimeout(abort, timeoutMs);
    signal?.addEventListener("abort", abort, { once: true });
    child.on("error", () => finish(true));
    child.stdin.on("error", () => finish(true));
    child.stdout.on("data", (piece) => {
      bytes += piece.length; if (bytes > 2048) abort(); else output += piece.toString("utf8");
    });
    child.stderr.on("data", (piece) => { bytes += piece.length; if (bytes > 4096) abort(); });
    child.on("close", (code) => {
      if (code !== 0) return finish(true);
      try { finish(false, JSON.parse(output)); } catch { finish(true); }
    });
    if (signal?.aborted) abort(); else child.stdin.end(payloadJson);
  });
  const keys = ["officialTemplateTokens", "officialTemplateWithResponseFormatTokens", "renderedUtf8ByteUpperBound", "inputTokensUpperBound"];
  if (!result || Object.keys(result).length !== 5 || result.payloadSha256 !== digest(payloadJson) ||
    keys.some((key) => !Number.isInteger(result[key]) || result[key] < 1 || result[key] > MAX_INPUT_TOKENS) ||
    result.inputTokensUpperBound !== result.renderedUtf8ByteUpperBound ||
    result.officialTemplateTokens > result.inputTokensUpperBound || result.officialTemplateWithResponseFormatTokens > result.inputTokensUpperBound) {
    throw new ApiError("PROTECTION_LIMIT", 422);
  }
  return result;
}
