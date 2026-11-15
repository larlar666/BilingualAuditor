import { parentPort, workerData } from "node:worker_threads";
import { database } from "./support.mjs";
import { reserveTrial } from "../src/budget.mjs";
const db = database(workerData.path, false);
parentPort.postMessage("ready");
parentPort.once("message", async () => {
  try { parentPort.postMessage({ allowed: await reserveTrial(db, workerData.index, workerData.id) }); }
  catch { parentPort.postMessage({ error: true }); }
  finally { db.sqlite.close(); }
});
