import https from "node:https";
import { isIPv4 } from "node:net";
import { X509Certificate, randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { ApiError, LIMITS, SESSION_MS, STOP_REASONS } from "./contract.mjs";
import { createPhoneHandler, failure } from "./handler.mjs";
import { digest, checkPolicy } from "./token-meter.mjs";
import { openLocalLedger } from "../tools/phone-ledger.mjs";
export function isPrivateIPv4(value) {
  if (!isIPv4(value)) return false;
  const [a, b, c, d] = value.split(".").map(Number);
  return (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) &&
    !(b === 255 && c === 255 && d === 255) && d !== 0 && d !== 255;
}
export function validCredentials(apiKey, accessToken) {
  return typeof apiKey === "string" && /^[\x21-\x7e]{1,512}$/.test(apiKey) &&
    typeof accessToken === "string" && /^[A-Za-z0-9_-]{32,256}$/.test(accessToken);
}

// root and loopback are internal factory options solely for isolated offline TLS
// tests. No production command-line or stdin field can enable them.
export async function startPhoneProxy(input, { root, fetcher, meter, emit = () => {}, testLoopback = false,
  upstreamTimeoutMs, minimumIntervalMs, sessionMs = SESSION_MS } = {}) {
  const allowed = "accessToken,allowedClientAddress,apiKey,bindAddress,certificatePem,event,ledgerId,policySha256,port,privateKeyPem";
  if (!input || Object.keys(input).sort().join(",") !== allowed || input.event !== "START_PHONE_PROXY" ||
    !validCredentials(input.apiKey, input.accessToken) ||
    !(isPrivateIPv4(input.bindAddress) || (testLoopback && input.bindAddress === "127.0.0.1")) ||
    !(isPrivateIPv4(input.allowedClientAddress) || (testLoopback && input.allowedClientAddress === "127.0.0.1")) ||
    !Number.isInteger(input.port) || input.port < (testLoopback ? 0 : 1024) || input.port > 65535 ||
    typeof input.certificatePem !== "string" || input.certificatePem.length > 16384 ||
    typeof input.privateKeyPem !== "string" || input.privateKeyPem.length > 16384) throw new ApiError("SERVICE_UNAVAILABLE");
  const certificate = new X509Certificate(input.certificatePem), now = Date.now(), sessionExpiresAt = new Date(now + sessionMs).toISOString();
  if (certificate.checkIP(input.bindAddress) !== input.bindAddress || Date.parse(certificate.validFrom) > now ||
    Date.parse(certificate.validTo) < now + sessionMs) throw new ApiError("SERVICE_UNAVAILABLE");
  const checked = checkPolicy();
  if (input.policySha256 !== checked.policySha256) throw new ApiError("SERVICE_UNAVAILABLE");
  const db = openLocalLedger(root), controller = new AbortController(), sockets = new Set();
  let server, handler, sessionTimer, stopping;
  const stop = (reason = "USER_STOP") => {
    if (stopping) return stopping;
    if (!STOP_REASONS.includes(reason)) reason = "SERVER_ERROR";
    controller.abort(); clearTimeout(sessionTimer); handler?.clear();
    input.apiKey = undefined; input.accessToken = undefined; input.privateKeyPem = undefined; input.certificatePem = undefined;
    stopping = new Promise((resolve) => {
      const done = () => { db.close(); emit({ event: "PHONE_PROXY_STOPPED", reason }); resolve(); };
      if (!server?.listening) done(); else { server.close(done); for (const socket of sockets) socket.destroy(); }
    });
    return stopping;
  };
  try {
    if (db.ledgerId !== input.ledgerId) throw new ApiError("SERVICE_UNAVAILABLE");
    handler = createPhoneHandler({ db, apiKey: input.apiKey, accessToken: input.accessToken, policySha256: checked.policySha256,
      sessionExpiresAt, policyExpiresAt: checked.policyExpiresAt, signal: controller.signal, fetcher, meter, emit, upstreamTimeoutMs, minimumIntervalMs });
    server = https.createServer({ key: input.privateKeyPem, cert: input.certificatePem, minVersion: "TLSv1.2", maxHeaderSize: 4096,
      requestTimeout: 10000, headersTimeout: 5000, keepAliveTimeout: 1000 }, async (req, res) => {
      const requestController = new AbortController();
      req.on("aborted", () => requestController.abort());
      // IncomingMessage 'close' also happens after a normal complete upload. Only
      // an unfinished outgoing response indicates a phone disconnect here.
      res.on("close", () => { if (!res.writableEnded) requestController.abort(); });
      try {
        const length = req.headers["content-length"];
        if (length && (!/^\d+$/.test(length) || Number(length) > 16384)) throw new ApiError("INVALID_REQUEST", 400);
        const request = new Request(`https://${input.bindAddress}:${input.port}${req.url}`, {
          method: req.method, headers: req.headers, signal: requestController.signal,
          ...(!["GET", "HEAD"].includes(req.method) ? { body: Readable.toWeb(req), duplex: "half" } : {}),
        });
        const response = await handler.fetch(request);
        if (!res.destroyed) { res.writeHead(response.status, { ...Object.fromEntries(response.headers), Connection: "close" }); res.end(await response.text()); }
      } catch (error) {
        if (!res.destroyed) { const response = failure(error); res.writeHead(response.status, { ...Object.fromEntries(response.headers), Connection: "close" }); res.end(await response.text()); }
      }
    });
    server.maxHeadersCount = 16; server.maxRequestsPerSocket = 20;
    server.setTimeout(45000, (socket) => socket.destroy());
    server.on("connection", (socket) => {
      const remote = socket.remoteAddress?.replace(/^::ffff:/, "");
      if (remote !== input.allowedClientAddress || sockets.size >= 8) { socket.destroy(); return; }
      sockets.add(socket); socket.on("close", () => sockets.delete(socket));
    });
    server.on("clientError", (_error, socket) => socket.destroy());
    server.on("tlsClientError", (_error, socket) => socket.destroy());
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen({ host: input.bindAddress, port: input.port, exclusive: true }, () => { server.off("error", reject); resolve(); });
    });
    server.on("error", () => { void stop("SERVER_ERROR"); });
    const port = server.address().port;
    input.apiKey = undefined; input.accessToken = undefined; input.privateKeyPem = undefined; input.certificatePem = undefined;
    sessionTimer = setTimeout(() => { void stop("SESSION_EXPIRED"); }, sessionMs);
    const ready = { event: "PHONE_PROXY_READY", endpoint: `https://${input.bindAddress}:${port}/translate`,
      certificateSha256: digest(certificate.raw), bindAddress: input.bindAddress, allowedClientAddress: input.allowedClientAddress,
      port, sessionId: randomUUID(), sessionExpiresAt, policyExpiresAt: checked.policyExpiresAt, limits: LIMITS,
      budget: db.snapshot(), ledgerId: db.ledgerId };
    emit(ready);
    return { stop, ready, server };
  } catch (error) { await stop("START_FAILED"); throw error; }
}
