import test from "node:test";
import assert from "node:assert/strict";
import { Worker } from "node:worker_threads";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { database } from "./support.mjs";
import { reserveBudget } from "../src/budget.mjs";

test("independent SQLite connections concurrently reserve one shared budget without overshoot", async () => {
  for (const [monthly, rate, expected] of [[100, 6, 2], [10000, 3, 3]]) {
    const directory = mkdtempSync(join(tmpdir(), "bilingual-budget-"));
    const path = join(directory, "budget.sqlite");
    const db = database(path);
    db.sqlite.exec("PRAGMA journal_mode=WAL");
    const threads = Array.from({ length: 12 }, () => new Worker(new URL("./budget-thread.mjs", import.meta.url), {
      workerData: { path, cost: 40, settings: { monthly, rate }, now: "2026-11-06T01:00:00.000Z" },
    }));
    try {
      await Promise.all(threads.map((thread) => once(thread, "message")));
      const results = threads.map((thread) => once(thread, "message"));
      threads.forEach((thread) => thread.postMessage("go"));
      const values = (await Promise.all(results)).map(([result]) => result);
      assert.ok(values.every((value) => !value.error), JSON.stringify(values));
      assert.equal(values.filter((value) => value.permitted).length, expected);
      const row = db.sqlite.prepare("SELECT * FROM translation_budget").get();
      assert.equal(row.characters, expected * 40);
      assert.equal(row.requests, expected);
      assert.ok(row.characters <= monthly);
    } finally {
      await Promise.all(threads.map((thread) => thread.terminate()));
      db.sqlite.close();
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

test("minute and UTC month rollover preserve previous aggregate, failed reservations do not increment", async () => {
  const db = database(), settings = { monthly: 50, rate: 1 };
  assert.equal(await reserveBudget(db, 20, settings, new Date("2026-11-30T23:58:00Z")), null);
  assert.equal(await reserveBudget(db, 20, settings, new Date("2026-11-30T23:58:01Z")), "RATE_LIMITED");
  assert.equal(await reserveBudget(db, 20, settings, new Date("2026-11-30T23:59:00Z")), null);
  assert.equal(await reserveBudget(db, 20, settings, new Date("2026-11-30T23:59:01Z")), "QUOTA_EXCEEDED");
  assert.equal(await reserveBudget(db, 20, settings, new Date("2026-12-01T00:00:00Z")), null);
  const rows = db.sqlite.prepare("SELECT * FROM translation_budget ORDER BY month").all();
  assert.deepEqual(rows.map((row) => [row.month, row.characters]), [["2026-11", 40], ["2026-12", 20]]);
  db.sqlite.close();
});

test("delayed previous-minute requests cannot roll the persisted rate window backward", async () => {
  const db = database(), settings = { monthly: 1000, rate: 1 };
  assert.equal(await reserveBudget(db, 20, settings, new Date("2026-11-06T01:01:00Z")), null);
  assert.equal(await reserveBudget(db, 20, settings, new Date("2026-11-06T01:00:59Z")), "RATE_LIMITED");
  assert.equal(await reserveBudget(db, 20, settings, new Date("2026-11-06T01:01:01Z")), "RATE_LIMITED");
  assert.equal(db.sqlite.prepare("SELECT characters FROM translation_budget").get().characters, 20);
  db.sqlite.close();
});
