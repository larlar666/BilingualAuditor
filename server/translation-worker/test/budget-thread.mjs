import { parentPort, workerData } from "node:worker_threads";
import { database } from "./support.mjs";
import { reserveBudget } from "../src/budget.mjs";

const db = database(workerData.path);
parentPort.postMessage("ready");
parentPort.once("message", async () => {
  try {
    const result = await reserveBudget(db, workerData.cost, workerData.settings, new Date(workerData.now));
    parentPort.postMessage({ permitted: result === null, denied: result });
  } catch (error) { parentPort.postMessage({ error: error.message }); }
  finally { db.sqlite.close(); }
});
