import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { initializeLocalLedger, openLocalLedger } from "../tools/phone-ledger.mjs";
import { createPhoneHandler } from "../src/handler.mjs";
import { checkPolicy } from "../src/token-meter.mjs";
export const token = "synthetic-offline-test-access-token-000000";
export const key = "synthetic-not-a-real-key";
export function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "phone-proxy-offline-"));
  return { root, initialize: () => initializeLocalLedger(root), open: () => openLocalLedger(root),
    clean() { assert.equal(path.dirname(root), tmpdir()); assert.ok(path.basename(root).startsWith("phone-proxy-offline-")); rmSync(root, { recursive: true, force: true }); } };
}
export function req(text = "今天。", { id = randomUUID(), auth = token, method = "POST", route = "/translate", raw } = {}) {
  return new Request(`https://phone.invalid${route}`, { method,
    headers: { Authorization: `Bearer ${auth}`, "Content-Type": "application/json" },
    ...(method !== "GET" ? { body: raw ?? JSON.stringify({ text, requestId: id }) } : {}) });
}
export function model(content = "A translated sentence.", change = {}) {
  return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { role: "assistant", content: JSON.stringify({ translation: content }) } }],
    usage: { prompt_tokens: 200, completion_tokens: 20 }, ...change }), { status: 200 });
}
export const fakeMeter = async () => ({ inputTokensUpperBound: 32768 });
export function handler(db, extra = {}) {
  return createPhoneHandler({ db, apiKey: key, accessToken: token, policySha256: checkPolicy().policySha256,
    sessionExpiresAt: new Date(Date.now() + 7200000).toISOString(), minimumIntervalMs: 0, meter: fakeMeter,
    fetcher: async () => model(), ...extra });
}
export function certificate() {
  // Offline self-signed loopback certificate, generated in memory; no cert store,
  // private-key file, model, network, or real credentials.
  const source = `$ErrorActionPreference='Stop'; $rsa=[System.Security.Cryptography.RSA]::Create(2048)
try {
 $request=[System.Security.Cryptography.X509Certificates.CertificateRequest]::new('CN=offline-phone-test',$rsa,[System.Security.Cryptography.HashAlgorithmName]::SHA256,[System.Security.Cryptography.RSASignaturePadding]::Pkcs1)
 $san=[System.Security.Cryptography.X509Certificates.SubjectAlternativeNameBuilder]::new()
 $san.AddIpAddress([System.Net.IPAddress]::Parse('127.0.0.1'));$request.CertificateExtensions.Add($san.Build())
 $cert=$request.CreateSelfSigned([DateTimeOffset]::UtcNow.AddMinutes(-1),[DateTimeOffset]::UtcNow.AddHours(3))
 try { @{certificatePem=$cert.ExportCertificatePem();privateKeyPem=$rsa.ExportPkcs8PrivateKeyPem()} | ConvertTo-Json -Compress } finally { $cert.Dispose() }
} finally { $rsa.Dispose() }`;
  const child = spawnSync("pwsh", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", source],
    { encoding: "utf8", windowsHide: true, timeout: 15000, maxBuffer: 32768 });
  assert.equal(child.status, 0, "offline certificate helper succeeded");
  return JSON.parse(child.stdout);
}
