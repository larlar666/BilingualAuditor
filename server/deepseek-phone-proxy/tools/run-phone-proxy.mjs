import path from "node:path";
import { fileURLToPath } from "node:url";
import { LIMITS } from "../src/contract.mjs";
import { checkPolicy, measurePayload } from "../src/token-meter.mjs";
import { preparePhone1000Text, buildPhoneRequest } from "../src/phone-text.mjs";
import { initializeLocalLedger, openLocalLedger } from "./phone-ledger.mjs";
import { startPhoneProxy } from "../src/server.mjs";

export async function checkPhoneProxy({ initialize = false, root } = {}) {
  const policy = checkPolicy();
  await measurePayload(JSON.stringify(buildPhoneRequest(preparePhone1000Text("离线计量检查。"))));
  if (initialize) initializeLocalLedger(root);
  const db = openLocalLedger(root);
  try {
    return { event: "PHONE_PROXY_CHECK_OK", ...policy, ledgerId: db.ledgerId, ledgerInitialized: initialize,
      limits: LIMITS, budget: db.snapshot() };
  } finally { db.close(); }
}

export async function serve({ root, start = startPhoneProxy, stdin = process.stdin, stdout = process.stdout, events = process } = {}) {
  // Fail closed before requesting credentials; never initialize in serve mode.
  checkPolicy(); const db = openLocalLedger(root); db.close();
  let proxy, starting, first = true, stopping = false, failed = false, buffer = "", total = 0;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const emit = (event) => stdout.write(JSON.stringify(event) + "\n");
  await new Promise((resolve) => {
    const cleanup = () => {
      clearTimeout(timer); events.off("SIGINT", interrupt); events.off("SIGTERM", interrupt);
      stdin.off("data", data); stdin.off("end", ended); stdin.off("error", invalid);
      stdin.pause(); resolve();
    };
    const finish = async (reason, failure = false) => {
      if (stopping) return; stopping = true; failed ||= failure;
      clearTimeout(timer);
      if (starting) { try { await starting; } catch { failed = true; } }
      if (proxy) await proxy.stop(reason);
      else emit({ event: failed ? "PHONE_PROXY_FAILED" : "PHONE_PROXY_STOPPED", reason: failed ? "INPUT_OR_START_FAILED" : reason });
      buffer = ""; cleanup();
    };
    const interrupt = () => { void finish("INTERRUPTED"); };
    const invalid = () => { void finish("INPUT_INVALID", true); };
    const ended = () => { try { if (decoder.decode() || buffer.trim()) return invalid(); } catch { return invalid(); } void finish("PARENT_EOF"); };
    const data = (piece) => {
      if (stopping) return;
      total += piece.length; if (total > 65536) return invalid();
      try { buffer += decoder.decode(piece, { stream: true }); } catch { return invalid(); }
      if (buffer.length > 49152) return invalid();
      while (buffer.includes("\n")) {
        const index = buffer.indexOf("\n"), line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
        let value;
        try { value = JSON.parse(line); } catch { return invalid(); }
        if (first) {
          first = false; clearTimeout(timer);
          starting = start(value, { emit: (event) => {
            emit(event);
            if (event.event === "PHONE_PROXY_STOPPED" && !stopping) { stopping = true; cleanup(); }
          } }).then((result) => { proxy = result; }).catch(() => { failed = true; });
          void starting.then(() => { if (!proxy && !stopping) void finish("START_FAILED", true); });
        } else {
          if (!value || Object.keys(value).join(",") !== "event" || value.event !== "STOP_PHONE_PROXY") return invalid();
          void finish("USER_STOP"); return;
        }
      }
    };
    const timer = setTimeout(() => { void finish("INPUT_TIMEOUT", true); }, 30000);
    events.on("SIGINT", interrupt); events.on("SIGTERM", interrupt);
    stdin.on("data", data); stdin.on("end", ended); stdin.on("error", invalid);
    stdin.resume();
  });
  process.exitCode = failed ? 1 : 0;
}
async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2 || !["--check", "--serve"].includes(args[0]) || args[1] !== "--cny-account-confirmed" ||
    !(args.length === 2 || (args[0] === "--check" && args.length === 3 && args[2] === "--initialize-ledger"))) {
    throw new Error("ARGUMENTS_INVALID");
  }
  if (args[0] === "--check") console.log(JSON.stringify(await checkPhoneProxy({ initialize: args.length === 3 })));
  else await serve();
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(); }
  catch { console.log(JSON.stringify({ event: "PHONE_PROXY_FAILED", reason: "GATE_FAILED" })); process.exitCode = 1; }
}
