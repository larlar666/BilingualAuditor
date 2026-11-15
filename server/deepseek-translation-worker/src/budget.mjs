import { TRIAL_ID } from "./trial.mjs";

export const RESERVATION_MICRO_CNY = 250000;
export const TRIAL_LIMIT_MICRO_CNY = 1000000;
// One conditional write claims budget, a unique sample and a unique request ID together.
// There is no month/day and no runtime INSERT: only the reviewed migration creates this trial.
export const RESERVE = `UPDATE deepseek_trial_budget SET
  reserved_micro_cny = reserved_micro_cny + 250000,
  attempts = attempts + 1,
  sample_mask = sample_mask | ?,
  request_ids = request_ids || ? || '|'
  WHERE trial_id = ? AND reserved_micro_cny + 250000 <= 1000000 AND attempts < 4
  AND (sample_mask & ?) = 0 AND instr(request_ids, '|' || ? || '|') = 0`;
export const READ = `SELECT reserved_micro_cny, attempts, sample_mask FROM deepseek_trial_budget WHERE trial_id = ?`;

export async function reserveTrial(db, sampleIndex, requestId) {
  if (!Number.isInteger(sampleIndex) || sampleIndex < 0 || sampleIndex > 3 ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(requestId)) {
    throw new Error("INVALID_RESERVATION");
  }
  const bit = 1 << sampleIndex;
  const result = await db.prepare(RESERVE).bind(bit, requestId.toLowerCase(), TRIAL_ID, bit, requestId.toLowerCase()).run();
  if (result.success !== true) throw new Error("BUDGET_UNAVAILABLE");
  if (result.meta?.changes === 1) return true;
  // A missing/corrupt migration fails closed rather than looking like an exhausted valid trial.
  const row = await db.prepare(READ).bind(TRIAL_ID).first();
  if (!row || !Number.isInteger(row.reserved_micro_cny) || !Number.isInteger(row.attempts) ||
    row.reserved_micro_cny !== row.attempts * RESERVATION_MICRO_CNY || row.attempts < 0 || row.attempts > 4 ||
    !Number.isInteger(row.sample_mask) || row.sample_mask < 0 || row.sample_mask > 15) throw new Error("BUDGET_UNAVAILABLE");
  return false;
}
