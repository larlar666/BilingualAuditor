import { parentPort, workerData } from "node:worker_threads";
import { openLocalLedger } from "../tools/phone-ledger.mjs";
let db;
try {
  db = openLocalLedger(workerData.root); parentPort.postMessage("ready");
  parentPort.once("message", () => { try { parentPort.postMessage(db.reserve(workerData.id)); }
    catch { parentPort.postMessage("error"); } finally { db.close(); } });
} catch { parentPort.postMessage("error"); }
