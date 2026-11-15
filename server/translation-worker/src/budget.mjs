export const INSERT_MONTH = `INSERT OR IGNORE INTO translation_budget
  (month, characters, minute, requests) VALUES (?, 0, ?, 0)`;

// One conditional write reserves both the monthly budget and the current
// minute's request. Do not split these checks into read-then-write operations.
export const RESERVE = `UPDATE translation_budget SET
  characters = characters + ?,
  requests = CASE WHEN minute = ? THEN requests + 1 ELSE 1 END,
  minute = ?
  WHERE month = ? AND characters + ? <= ?
  AND minute <= ? AND (minute < ? OR requests < ?)`;

export const READ_MONTH = `SELECT characters, minute, requests
  FROM translation_budget WHERE month = ?`;

export async function reserveBudget(db, cost, settings, now = new Date()) {
  const month = now.toISOString().slice(0, 7);
  const minute = Math.floor(now.getTime() / 60000);
  const inserted = await db.prepare(INSERT_MONTH).bind(month, minute).run();
  if (!inserted.success) throw new Error("Budget storage unavailable");
  const reserved = await db.prepare(RESERVE).bind(
    cost, minute, minute, month, cost, settings.monthly, minute, minute, settings.rate,
  ).run();
  if (!reserved.success) throw new Error("Budget storage unavailable");
  if (reserved.meta?.changes === 1) return null;
  // This read only chooses an error message. It never grants permission.
  const row = await db.prepare(READ_MONTH).bind(month).first();
  if (!row) throw new Error("Budget storage unavailable");
  return row.characters + cost > settings.monthly ? "QUOTA_EXCEEDED" : "RATE_LIMITED";
}
