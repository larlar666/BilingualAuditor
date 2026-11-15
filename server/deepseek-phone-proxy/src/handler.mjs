import { createHash, timingSafeEqual } from "node:crypto";
import { ApiError, MESSAGES, LIMITS, UUID, MAX_INPUT_TOKENS, MAX_OUTPUT_TOKENS } from "./contract.mjs";
import { preparePhone1000Text, hasHan, buildPhoneRequest, restorePhoneTranslation } from "./phone-text.mjs";
import { checkPolicy, measurePayload } from "./token-meter.mjs";
const hash = (value) => createHash("sha256").update(value).digest();
export function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}
export function failure(error) {
  const value = error instanceof ApiError && Object.hasOwn(MESSAGES, error.code) ? error : new ApiError("SERVICE_UNAVAILABLE");
  return json({ error: { code: value.code, message: MESSAGES[value.code] } }, value.status);
}
export async function limitedText(message, maximum) {
  if (Number(message.headers.get("content-length")) > maximum) throw new Error("SIZE_LIMIT");
  if (!message.body) return "";
  const reader = message.body.getReader(), decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0, result = "";
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      bytes += value.length; if (bytes > maximum) throw new Error("SIZE_LIMIT");
      result += decoder.decode(value, { stream: true });
    }
    return result + decoder.decode();
  } finally { await reader.cancel().catch(() => {}); }
}

// Dependency overrides exist only for offline tests. The production CLI never
// chooses dependencies from arguments, environment or phone input.
export function createPhoneHandler({ db, apiKey, accessToken, policySha256, sessionExpiresAt,
  policyExpiresAt = checkPolicy().policyExpiresAt,
  fetcher = (...args) => fetch(...args), meter = measurePayload, policy = checkPolicy,
  signal, emit = () => {}, upstreamTimeoutMs = 30000, minimumIntervalMs = 3000 } = {}) {
  let authHash = hash(`Bearer ${accessToken}`), key = apiKey, busy = false, lastAttempt = -Infinity, stopped = false;
  apiKey = undefined; accessToken = undefined;
  const currentPolicy = () => {
    const current = policy();
    if (current.policySha256 !== policySha256 || stopped || signal?.aborted || Date.now() >= Date.parse(sessionExpiresAt)) {
      throw new ApiError("SERVICE_UNAVAILABLE");
    }
    return current;
  };
  const health = () => {
    let translationReady = false;
    try { currentPolicy(); translationReady = db.snapshot().remainingAttempts > 0; } catch { /* safe state */ }
    return { status: "ok", service: "bilingual-auditor-phone-proxy", translationReady, limits: LIMITS,
      budget: db.snapshot(), policyExpiresAt, sessionExpiresAt };
  };
  return {
    clear() { stopped = true; key = undefined; authHash.fill(0); },
    async fetch(request) {
      let ownsBusy = false;
      try {
        const received = request.headers.get("authorization") ?? "";
        if (stopped || received.length > 300 || !timingSafeEqual(authHash, hash(received))) throw new ApiError("UNAUTHORIZED", 401);
        const url = new URL(request.url);
        if (url.protocol !== "https:" || url.search) throw new ApiError("INVALID_REQUEST", 400);
        if (request.method === "GET" && url.pathname === "/health") return json(health());
        if (request.method !== "POST" || url.pathname !== "/translate" ||
          !/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) throw new ApiError("INVALID_REQUEST", 400);
        let body;
        try { body = JSON.parse(await limitedText(request, 16384)); } catch { throw new ApiError("INVALID_REQUEST", 400); }
        if (!body || Array.isArray(body) || Object.keys(body).sort().join(",") !== "requestId,text" ||
          typeof body.requestId !== "string" || !UUID.test(body.requestId)) throw new ApiError("INVALID_REQUEST", 400);
        const prepared = preparePhone1000Text(body.text);
        if (!hasHan(body.text)) return json({ requestId: body.requestId, translation: body.text });
        currentPolicy();
        if (busy || Date.now() - lastAttempt < minimumIntervalMs) throw new ApiError("RATE_LIMITED", 429);
        busy = true; ownsBusy = true;
        const payloadJson = JSON.stringify(buildPhoneRequest(prepared));
        const combinedSignal = signal ? AbortSignal.any([signal, request.signal]) : request.signal;
        const measured = await meter(payloadJson, { signal: combinedSignal });
        currentPolicy();
        if (combinedSignal.aborted) throw new ApiError("SERVICE_UNAVAILABLE");
        if (!Number.isInteger(measured.inputTokensUpperBound) || measured.inputTokensUpperBound < 1 ||
          measured.inputTokensUpperBound > MAX_INPUT_TOKENS) throw new ApiError("PROTECTION_LIMIT", 422);
        if (!db.reserve(body.requestId.toLowerCase())) throw new ApiError("QUOTA_EXCEEDED", 403);
        lastAttempt = Date.now();
        emit({ event: "PHONE_PROXY_BUDGET", ledgerId: db.ledgerId, budget: db.snapshot() });
        const controller = new AbortController(), timer = setTimeout(() => controller.abort(), upstreamTimeoutMs);
        let upstream, response;
        try {
          response = await fetcher("https://api.deepseek.com/chat/completions", {
            method: "POST", redirect: "manual", signal: AbortSignal.any([controller.signal, combinedSignal]),
            headers: { "Content-Type": "application/json; charset=utf-8", Authorization: `Bearer ${key}` }, body: payloadJson,
          });
          if (response.status >= 300 && response.status < 400) { await response.body?.cancel(); throw new Error("REDIRECT"); }
          if (!response.ok) { await response.body?.cancel(); throw new ApiError(response.status === 429 ? "RATE_LIMITED" : "UPSTREAM_ERROR", response.status === 429 ? 429 : 502); }
          upstream = JSON.parse(await limitedText(response, 131072));
        } catch (error) {
          if (error instanceof ApiError) throw error;
          throw new ApiError(controller.signal.aborted ? "UPSTREAM_TIMEOUT" : "UPSTREAM_ERROR", 502);
        } finally { clearTimeout(timer); }
        const choice = upstream?.choices?.[0], usage = upstream?.usage;
        if (!Array.isArray(upstream?.choices) || upstream.choices.length !== 1 || choice?.finish_reason !== "stop" ||
          choice.message?.role !== "assistant" || choice.message.tool_calls != null || choice.message.function_call != null ||
          (choice.message.reasoning_content != null && choice.message.reasoning_content !== "") ||
          !usage || !Number.isInteger(usage.prompt_tokens) || usage.prompt_tokens < 1 || usage.prompt_tokens > measured.inputTokensUpperBound ||
          !Number.isInteger(usage.completion_tokens) || usage.completion_tokens < 1 || usage.completion_tokens > MAX_OUTPUT_TOKENS) {
          throw new ApiError("UPSTREAM_ERROR", 502);
        }
        let translation;
        try { translation = restorePhoneTranslation(choice.message.content, prepared.fragments); }
        catch { throw new ApiError("PRESERVATION_FAILED", 502); }
        emit({ event: "PHONE_PROXY_BUDGET", ledgerId: db.ledgerId, budget: db.snapshot(),
          usage: { promptTokens: usage.prompt_tokens, completionTokens: usage.completion_tokens },
          estimatedPeakCostMicroCny: usage.prompt_tokens * 2 + usage.completion_tokens * 8 });
        return json({ requestId: body.requestId, translation });
      } catch (error) { return failure(error); }
      finally { if (ownsBusy) busy = false; }
    },
  };
}
