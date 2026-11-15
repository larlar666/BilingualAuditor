import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync,
  renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AUTHORITY as LOCAL_AUTHORITY, TRIAL_ID, budgetView } from "../src/contract.mjs";

export const WORKER_DIRECTORY = realpathSync(fileURLToPath(new URL("..", import.meta.url)));
const filename = "phone-demo-v1.sqlite";
const markername = "phone-demo-v1.initialized.json";
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const fail = (condition) => { if (!condition) throw new Error("LOCAL_LEDGER_UNAVAILABLE"); };

// The optional root is for isolated offline tests. The CLI never accepts a root/path override.
function locations(root = WORKER_DIRECTORY, create = false) {
  const canonicalRoot = realpathSync(root), directory = path.join(canonicalRoot, ".local");
  if (!existsSync(directory) && create) mkdirSync(directory, { mode: 0o700 });
  fail(existsSync(directory) && lstatSync(directory).isDirectory() && !lstatSync(directory).isSymbolicLink());
  fail(realpathSync(directory) === directory);
  return { directory, file: path.join(directory, filename), marker: path.join(directory, markername) };
}

function readMarker(file) {
  fail(existsSync(file) && lstatSync(file).isFile() && !lstatSync(file).isSymbolicLink() && lstatSync(file).size < 4096);
  const value = JSON.parse(readFileSync(file, "utf8"));
  fail(value?.schema === "deepseek-phone-ledger-v1" && value.state === "initialized" &&
    value.trialId === TRIAL_ID && value.executionAuthority === LOCAL_AUTHORITY && uuid.test(value.ledgerId));
  return value;
}

function validateRow(sqlite) {
  const rows = sqlite.prepare("SELECT * FROM phone_budget").all();
  fail(rows.length === 1);
  const row = rows[0];
  fail(row.trial_id === TRIAL_ID && Number.isInteger(row.attempts) && row.attempts >= 0 && row.attempts <= 20 &&
    Number.isInteger(row.reserved_micro_cny) && row.reserved_micro_cny === row.attempts * 150000 &&
    typeof row.request_ids === "string" &&
    row.request_ids.startsWith("|") && row.request_ids.endsWith("|"));
  const ids = row.request_ids.split("|").slice(1, -1);
  fail(ids.length === row.attempts && ids.every((id) => uuid.test(id)) && new Set(ids).size === ids.length);
  return budgetView({ attempts: row.attempts, reservedMicroCny: row.reserved_micro_cny });
}

export function initializeLocalLedger(root = WORKER_DIRECTORY) {
  const place = locations(root, true);
  // Both leftovers and completed ledgers block initialization. Never overwrite or repair silently.
  fail(!existsSync(place.file) && !existsSync(place.marker));
  const metadata = { schema: "deepseek-phone-ledger-v1", state: "initializing", trialId: TRIAL_ID,
    executionAuthority: LOCAL_AUTHORITY, ledgerId: randomUUID() };
  writeFileSync(place.marker, JSON.stringify(metadata), { flag: "wx", mode: 0o600 });
  let sqlite, completionFile;
  try {
    closeSync(openSync(place.file, "wx", 0o600));
    sqlite = new DatabaseSync(place.file);
    const schema = readFileSync(new URL("../migrations/0001_phone_budget.sql", import.meta.url), "utf8");
    sqlite.exec("BEGIN IMMEDIATE");
    sqlite.exec(schema);
    sqlite.exec("CREATE TABLE local_trial_authority (slot INTEGER PRIMARY KEY CHECK(slot=1), trial_id TEXT NOT NULL, authority TEXT NOT NULL, ledger_id TEXT NOT NULL)");
    sqlite.prepare("INSERT INTO local_trial_authority VALUES (1, ?, ?, ?)").run(TRIAL_ID, LOCAL_AUTHORITY, metadata.ledgerId);
    sqlite.exec("PRAGMA user_version=1; COMMIT");
    validateRow(sqlite);
    sqlite.close(); sqlite = null;
    completionFile = path.join(place.directory, `${markername}.${randomUUID()}.complete`);
    writeFileSync(completionFile, JSON.stringify({ ...metadata, state: "initialized" }), { flag: "wx", mode: 0o600 });
    renameSync(completionFile, place.marker); completionFile = null;
  } finally {
    sqlite?.close();
    if (completionFile && existsSync(completionFile)) unlinkSync(completionFile);
    // An interrupted marker/database is intentionally retained for manual inspection, not reset.
  }
  return metadata.ledgerId;
}

export function openLocalLedger(root = WORKER_DIRECTORY) {
  const place = locations(root), metadata = readMarker(place.marker);
  fail(existsSync(place.file) && lstatSync(place.file).isFile() && !lstatSync(place.file).isSymbolicLink());
  const sqlite = new DatabaseSync(place.file, { open: true });
  const identity = statSync(place.file);
  let closed = false;
  try {
    sqlite.exec("PRAGMA busy_timeout=10000");
    fail(sqlite.prepare("PRAGMA user_version").get().user_version === 1);
    const authorities = sqlite.prepare("SELECT * FROM local_trial_authority").all();
    fail(authorities.length === 1 && authorities[0].slot === 1 && authorities[0].trial_id === TRIAL_ID &&
      authorities[0].authority === LOCAL_AUTHORITY && authorities[0].ledger_id === metadata.ledgerId);
    validateRow(sqlite);
  } catch (error) { sqlite.close(); throw error; }
  const assertIdentity = () => {
    fail(!closed && readMarker(place.marker).ledgerId === metadata.ledgerId &&
      existsSync(place.file) && !lstatSync(place.file).isSymbolicLink());
    const current = statSync(place.file);
    fail(current.dev === identity.dev && current.ino === identity.ino);
    const authorities = sqlite.prepare("SELECT * FROM local_trial_authority").all();
    fail(sqlite.prepare("PRAGMA user_version").get().user_version === 1 && authorities.length === 1 &&
      authorities[0].slot === 1 && authorities[0].trial_id === TRIAL_ID &&
      authorities[0].authority === LOCAL_AUTHORITY && authorities[0].ledger_id === metadata.ledgerId);
  };
  return {
    ledgerId: metadata.ledgerId,
    snapshot() { assertIdentity(); return validateRow(sqlite); },
    reserve(requestId) {
      fail(typeof requestId === "string" && uuid.test(requestId));
      assertIdentity(); validateRow(sqlite);
      const result = sqlite.prepare(`UPDATE phone_budget
        SET attempts=attempts+1, reserved_micro_cny=reserved_micro_cny+150000,
            request_ids=request_ids || ? || '|'
        WHERE trial_id=? AND attempts<20 AND reserved_micro_cny+150000<=3000000
          AND instr(request_ids, '|' || ? || '|')=0`).run(requestId, TRIAL_ID, requestId);
      validateRow(sqlite);
      return Number(result.changes) === 1;
    },
    close() { if (!closed) { sqlite.close(); closed = true; } },
  };
}
