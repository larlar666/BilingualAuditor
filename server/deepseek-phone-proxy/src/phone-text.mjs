import { buildTrialRequest, TRIAL_CASES, restoreTranslation, hasHan, hasUnsupportedLetters } from "../../deepseek-translation-worker/src/trial.mjs";
import { ApiError, LIMITS, MAX_OUTPUT_TOKENS } from "./contract.mjs";
export { hasHan };

export function preparePhone1000Text(text) {
  if (typeof text !== "string" || !text.trim() || text !== text.toWellFormed() || hasUnsupportedLetters(text)) {
    throw new ApiError("INVALID_REQUEST", 400);
  }
  if ([...text].length > LIMITS.maxInputCodePoints) throw new ApiError("TEXT_TOO_LONG", 422);
  if (text.includes("__BA_KEEP_") || text.includes("<｜")) throw new ApiError("PROTECTION_LIMIT", 422);
  const fragments = [];
  // Chinese punctuation belongs to translatable context. Boundary whitespace is
  // excluded from English fragments; spelling, case and interior bytes stay exact.
  const source = [...text.matchAll(/\p{Script=Han}+|[\u3000-\u303f\uff00-\uff65]+|[^\p{Script=Han}\u3000-\u303f\uff00-\uff65]+/gu)]
    .map(([part]) => {
      if (!/\p{Script=Latin}/u.test(part)) return part;
      const kept = part.trim(), marker = `__BA_KEEP_${fragments.length}__`;
      fragments.push({ marker, text: kept });
      return part.slice(0, part.length - part.trimStart().length) + marker + part.slice(part.trimEnd().length);
    }).join("");
  return { source, fragments };
}
export function buildPhoneRequest(prepared) {
  // Reuse the fixed trial's reviewed system instructions, not its fixed-case gate.
  const base = buildTrialRequest(TRIAL_CASES[0].text);
  base.max_tokens = MAX_OUTPUT_TOKENS;
  base.messages[0].content += ' Example JSON output: {"translation":"An English sentence."}';
  base.messages[1].content = JSON.stringify({ source: prepared.source, protectedEnglish: prepared.fragments });
  return base;
}
export function restorePhoneTranslation(content, fragments) {
  // Normalize only generated whitespace at marker boundaries before restoring
  // protected bytes. Never normalize or correct the English fragment itself.
  let data;
  try { data = JSON.parse(content); } catch { return restoreTranslation(content, fragments); }
  if (data && typeof data.translation === "string") {
    data.translation = data.translation.replace(/\s*(__BA_KEEP_\d+__)\s*/g, (whole, marker, offset, all) =>
      (offset > 0 && /^\s/.test(whole) ? " " : "") + marker +
      (offset + whole.length < all.length && /\s$/.test(whole) ? " " : ""));
  }
  return restoreTranslation(JSON.stringify(data), fragments);
}
