import { parentPort, workerData } from "node:worker_threads";
import { openLocalLedger } from "../tools/local-ledger.mjs";
import { reserveTrial } from "../src/budget.mjs";
let db;
try {
  db = openLocalLedger(workerData.root);
  parentPort.postMessage("ready");
  parentPort.once("message", async () => {
    try { parentPort.postMessage({ allowed: await reserveTrial(db, workerData.index, workerData.id) }); }
    catch { parentPort.postMessage({ error: true }); }
    finally { db.close(); }
  });
} catch { parentPort.postMessage({ error: true }); }
