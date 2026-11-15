import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Worker } from "node:worker_threads";
import { once } from "node:events";
import { writeFileSync, readFileSync, unlinkSync, mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fixture } from "./support.mjs";

test("explicit independent initialization; UUID replay and restart preserve charges", () => {
  const f = fixture(); let db;
  try {
    assert.throws(f.open); f.initialize(); assert.throws(f.initialize);
    db = f.open(); const ledgerId = db.ledgerId, id = randomUUID();
    assert.equal(db.reserve(id), true); assert.equal(db.reserve(id), false); db.close(); db = f.open();
    assert.equal(db.ledgerId, ledgerId); assert.equal(db.reserve(id), false);
    for (let i = 1; i < 20; i++) assert.equal(db.reserve(randomUUID()), true);
    assert.equal(db.reserve(randomUUID()), false);
    assert.deepEqual(db.snapshot(), { attempts: 20, reservedMicroCny: 3000000, remainingAttempts: 0, remainingReserveMicroCny: 0 });
  } finally { db?.close(); f.clean(); }
});
test("real SQLite competing connections atomically stop at twenty and three yuan", async () => {
  const f = fixture(); const workers = [];
  try {
    f.initialize();
    for (let i = 0; i < 26; i++) workers.push(new Worker(new URL("./budget-thread.mjs", import.meta.url), { workerData: { root: f.root, id: randomUUID() } }));
    const ready = await Promise.all(workers.map(async (worker) => (await once(worker, "message"))[0]));
    assert.ok(ready.every((value) => value === "ready"));
    const pending = workers.map(async (worker) => (await once(worker, "message"))[0]);
    workers.forEach((worker) => worker.postMessage("go"));
    const result = await Promise.all(pending);
    assert.equal(result.filter((value) => value === true).length, 20);
    assert.equal(result.filter((value) => value === false).length, 6);
    const db = f.open(); assert.equal(db.snapshot().reservedMicroCny, 3000000); db.close();
  } finally { await Promise.all(workers.map((worker) => worker.terminate())); f.clean(); }
});
test("missing, interrupted, mismatched and corrupt ledgers fail closed", () => {
  for (const mode of ["partial", "missing-db", "bad-marker", "bad-row"]) {
    const f = fixture();
    try {
      const marker = path.join(f.root, ".local", "phone-demo-v1.initialized.json");
      const filename = path.join(f.root, ".local", "phone-demo-v1.sqlite");
      if (mode === "partial") { mkdirSync(path.dirname(marker)); writeFileSync(marker, '{}'); }
      else {
        f.initialize();
        if (mode === "missing-db") unlinkSync(filename);
        if (mode === "bad-marker") { const data = JSON.parse(readFileSync(marker)); data.ledgerId = randomUUID(); writeFileSync(marker, JSON.stringify(data)); }
        if (mode === "bad-row") { const sql = new DatabaseSync(filename); sql.exec("PRAGMA ignore_check_constraints=ON; UPDATE phone_budget SET attempts=1"); sql.close(); }
      }
      assert.throws(f.open); assert.throws(f.initialize);
    } finally { f.clean(); }
  }
});
