import test from "node:test";
import assert from "node:assert/strict";
import { Worker } from "node:worker_threads";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { database } from "./support.mjs";
import { reserveTrial } from "../src/budget.mjs";

test("12 independent SQLite contenders cannot overclaim the four fixed samples or CNY1 total", async () => {
  const directory = mkdtempSync(join(tmpdir(), "deepseek-fixed-budget-")), file = join(directory, "budget.sqlite");
  const db = database(file);
  db.sqlite.exec("PRAGMA journal_mode=WAL");
  const threads = Array.from({ length: 12 }, (_, index) => new Worker(new URL("./budget-thread.mjs", import.meta.url), {
    workerData: { path: file, index: index % 4, id: crypto.randomUUID() },
  }));
  try {
    await Promise.all(threads.map((thread) => once(thread, "message")));
    const results = threads.map((thread) => once(thread, "message"));
    threads.forEach((thread) => thread.postMessage("go"));
    const values = (await Promise.all(results)).map(([result]) => result);
    assert.ok(values.every((value) => !value.error));
    assert.equal(values.filter((value) => value.allowed).length, 4);
    const row = db.sqlite.prepare("SELECT * FROM deepseek_trial_budget").get();
    assert.equal(row.attempts, 4); assert.equal(row.reserved_micro_cny, 1000000); assert.equal(row.sample_mask, 15);
    assert.equal(row.request_ids.split("|").filter(Boolean).length, 4);
  } finally {
    await Promise.all(threads.map((thread) => thread.terminate()));
    db.sqlite.close(); rmSync(directory, { recursive: true, force: true });
  }
});

test("UUID dedupe and sample claims survive restart; no date or runtime insert resets this trial", async () => {
  const directory = mkdtempSync(join(tmpdir(), "deepseek-fixed-restart-")), file = join(directory, "budget.sqlite");
  const id = crypto.randomUUID(); let db = database(file);
  try {
    assert.equal(await reserveTrial(db, 0, id), true);
    assert.equal(await reserveTrial(db, 1, id.toUpperCase()), false);
    db.sqlite.close(); db = database(file, false);
    assert.equal(await reserveTrial(db, 0, crypto.randomUUID()), false);
    assert.equal(await reserveTrial(db, 1, crypto.randomUUID()), true);
    assert.equal(db.sqlite.prepare("SELECT reserved_micro_cny FROM deepseek_trial_budget").get().reserved_micro_cny, 500000);
    db.sqlite.exec("DELETE FROM deepseek_trial_budget");
    await assert.rejects(reserveTrial(db, 2, crypto.randomUUID()), /BUDGET_UNAVAILABLE/);
  } finally { db.sqlite.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("failed SQL metadata and invalid reservations cannot grant budget", async () => {
  for (const result of [{ success: false }, { success: true, meta: {} }]) {
    const db = { prepare() { return { bind() { return { async run() { return result; }, async first() { return null; } }; } }; } };
    await assert.rejects(reserveTrial(db, 0, crypto.randomUUID()));
  }
  const db = database();
  try {
    await assert.rejects(reserveTrial(db, 4, crypto.randomUUID()));
    await assert.rejects(reserveTrial(db, 0, "not-a-uuid"));
    assert.equal(db.sqlite.prepare("SELECT attempts FROM deepseek_trial_budget").get().attempts, 0);
  } finally { db.sqlite.close(); }
});
