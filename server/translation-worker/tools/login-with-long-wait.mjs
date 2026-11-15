import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { readFileSync, realpathSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Local, temporary adaptation of the pinned CLI; not an official Wrangler option.
const workerDirectory = realpathSync(fileURLToPath(new URL("..", import.meta.url)));
const account = "d06ab0448a151f1907b09bf22da3649a";
const version = "4.158.0";
const timerBlock = `  const timerPromise = new Promise((_5, reject) => {
    loginTimeoutHandle = setTimeout(() => {
      server.close();
      clearTimeout(loginTimeoutHandle);
      reject(
        new UserError(
          "Timed out waiting for authorization code, please try again.",
          { telemetryMessage: "user oauth authorization timeout" }
        )
      );
    }, 12e4);
  });`;

function check(condition, code) {
  if (!condition) throw new Error(code);
}
function inside(directory, candidate) {
  const relative = path.relative(directory, candidate);
  return relative !== "" && !path.isAbsolute(relative) && relative !== ".." &&
    !relative.startsWith(`..${path.sep}`);
}
function digest(bytes) { return createHash("sha256").update(bytes).digest("hex"); }

function extendOnlyAuthorizationWait(original) {
  const source = original.toString("utf8");
  check(Buffer.from(source, "utf8").equals(original), "SOURCE_ENCODING_CHANGED");
  const block = source.includes(timerBlock) ? timerBlock : timerBlock.replaceAll("\n", "\r\n");
  const first = source.indexOf(block);
  check(first >= 0 && source.indexOf(block, first + block.length) === -1, "TIMER_MATCH_NOT_UNIQUE");
  const functionStart = source.lastIndexOf("async function getOauthToken(options, state3, ctx, generators) {", first);
  const nextPhase = source.indexOf("  const loginPromise = new Promise", first);
  check(functionStart >= 0 && nextPhase > first && nextPhase - first < block.length + 8,
    "TIMER_CONTEXT_CHANGED");
  const literal = first + block.indexOf("12e4");
  const changed = Buffer.from(source.slice(0, literal) + "6e5" + source.slice(literal + 4), "utf8");
  // Exact byte reconstruction proves every byte outside this one literal is retained.
  const byteOffset = Buffer.byteLength(source.slice(0, literal), "utf8");
  check(changed.subarray(0, byteOffset).equals(original.subarray(0, byteOffset)) &&
    changed.subarray(byteOffset + 3).equals(original.subarray(byteOffset + 4)), "UNEXPECTED_SOURCE_CHANGE");
  return changed;
}

function cliEnvironment() {
  const env = { ...process.env,
    CLOUDFLARE_ACCOUNT_ID: account,
    CLOUDFLARE_API_BASE_URL: "https://api.cloudflare.com/client/v4",
    HTTP_PROXY: "http://127.0.0.1:7897", HTTPS_PROXY: "http://127.0.0.1:7897",
    NO_PROXY: "localhost,127.0.0.1,::1",
    WRANGLER_WRITE_LOGS: "false", WRANGLER_LOG_SANITIZE: "true", WRANGLER_LOG: "log",
    WRANGLER_SEND_METRICS: "false", WRANGLER_SEND_ERROR_REPORTS: "false",
  };
  delete env.WRANGLER_OUTPUT_FILE_PATH;
  delete env.WRANGLER_OUTPUT_FILE_DIRECTORY;
  return env;
}

async function withTemporaryCli(action) {
  const modules = realpathSync(path.join(workerDirectory, "node_modules"));
  const installedCli = realpathSync(path.join(modules, "wrangler", "wrangler-dist", "cli.js"));
  check(inside(modules, installedCli), "CLI_OUTSIDE_LOCAL_MODULES");
  const packageFile = path.join(path.dirname(path.dirname(installedCli)), "package.json");
  check(JSON.parse(readFileSync(packageFile, "utf8")).version === version, "PINNED_VERSION_MISMATCH");
  const original = readFileSync(installedCli);
  const originalHash = digest(original);
  const changed = extendOnlyAuthorizationWait(original);
  const temporaryCli = path.join(path.dirname(installedCli), `.codex-long-wait-${process.pid}-${randomUUID()}.cjs`);
  check(inside(modules, temporaryCli), "TEMPORARY_PATH_OUTSIDE_MODULES");
  let created = false;
  try {
    writeFileSync(temporaryCli, changed, { flag: "wx", mode: 0o600 });
    created = true;
    check(readFileSync(temporaryCli).equals(changed), "TEMPORARY_SOURCE_MISMATCH");
    return await action(temporaryCli);
  } finally {
    // Never delete an existing file or the vendor file; only this invocation's own copy.
    try {
      if (created) unlinkSync(temporaryCli);
      check(!created || !existsSync(temporaryCli), "TEMPORARY_CLEANUP_FAILED");
    } finally {
      check(digest(readFileSync(installedCli)) === originalHash, "ORIGINAL_CLI_HASH_CHANGED");
    }
  }
}

function runCli(temporaryCli, mode) {
  const arguments_ = mode === "login" ? ["login", "--browser=true", "--callback-host=localhost",
    "--no-use-keyring", "--scopes", "account:read", "user:read", "workers_scripts:write", "d1:write"] : ["--version"];
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--no-warnings", temporaryCli, ...arguments_], {
      cwd: workerDirectory, env: cliEnvironment(), shell: false,
      stdio: mode === "login" ? "inherit" : ["ignore", "pipe", "pipe"],
    });
    let output = "";
    if (mode !== "login") {
      const collect = (bytes) => {
        output += bytes.toString("utf8");
        if (output.length > 65536) child.kill();
      };
      child.stdout.on("data", collect); child.stderr.on("data", collect);
    }
    const forwardInterrupt = () => child.kill("SIGINT");
    const forwardTermination = () => child.kill("SIGTERM");
    process.on("SIGINT", forwardInterrupt); process.on("SIGTERM", forwardTermination);
    const detach = () => {
      process.off("SIGINT", forwardInterrupt); process.off("SIGTERM", forwardTermination);
    };
    child.once("error", () => { detach(); reject(new Error("CLI_START_FAILED")); });
    child.once("exit", (code) => { detach(); resolve({ code: code ?? 1, output }); });
  });
}

async function selfTest() {
  for (const invalid of [Buffer.from("no timer"), Buffer.from(`${timerBlock}\n${timerBlock}`)]) {
    let rejected = false;
    try { extendOnlyAuthorizationWait(invalid); } catch { rejected = true; }
    check(rejected, "INVALID_TIMER_ACCEPTED");
  }
  const result = await withTemporaryCli((temporaryCli) => runCli(temporaryCli, "version"));
  check(result.code === 0 && /\b4\.158\.0\b/.test(result.output), "OFFLINE_VERSION_FAILED");
  let failurePath = false;
  try {
    await withTemporaryCli(() => { throw new Error("EXPECTED_ACTION_FAILURE"); });
  } catch (error) { failurePath = error.message === "EXPECTED_ACTION_FAILURE"; }
  check(failurePath, "FAILURE_CLEANUP_FAILED");
  console.log("LONG_WAIT_SELFTEST_OK VERSION=4.158.0 WAIT_MS=600000 EXACT_TIMER_ONLY ORIGINAL_HASH_UNCHANGED CLEANUP_SUCCESS_AND_FAILURE NO_AUTH_NO_REMOTE");
}

const mode = process.argv.slice(2);
try {
  check(mode.length === 1 && ["--self-test", "--login"].includes(mode[0]), "EXPLICIT_MODE_REQUIRED");
  if (mode[0] === "--self-test") await selfTest();
  else {
    console.log("LOCAL_AUTH_WAIT_MS=600000 SAME_SCOPES_STATE_PKCE_REDIRECT ORIGINAL_VENDOR_UNCHANGED");
    const result = await withTemporaryCli((temporaryCli) => runCli(temporaryCli, "login"));
    console.log("TEMPORARY_CLI_REMOVED ORIGINAL_CLI_HASH_UNCHANGED");
    process.exitCode = result.code;
  }
} catch {
  // Never echo arbitrary CLI exceptions or file contents into the chat/log stream.
  console.error("LONG_WAIT_HELPER_FAILED SAFE_FAILURE");
  process.exitCode = 1;
}
