import { reserveTrial } from "./budget.mjs";
import { TOKEN_BOUND_MANIFEST } from "./token-bound-manifest.mjs";
import { TRIAL_ENABLE_VALUE, MAX_INPUT_TOKENS, MAX_OUTPUT_TOKENS, trialIndex, hasHan,
  hasUnsupportedLetters, buildTrialRequest, prepareTrial, restoreTranslation,
  verifyTokenBound, PreservationError, CLOUDFLARE_AUTHORITY } from "./trial.mjs";

const BODY_BYTES = 65536;
const RESPONSE_BYTES = 65536;
const messages = {
  INVALID_REQUEST: "本试验仅支持预先批准的四个短合成样本。",
  TEXT_TOO_LONG: "文段超出长度范围。", UNAUTHORIZED: "访问凭证无效。",
  QUOTA_EXCEEDED: "本次试验样本或总额度已使用。", SERVICE_UNAVAILABLE: "翻译试验暂不可用。",
  UPSTREAM_TIMEOUT: "翻译请求超时。", UPSTREAM_ERROR: "翻译服务未能返回有效结果。",
  PRESERVATION_FAILED: "未能确认原有英文完整保留。", RATE_LIMITED: "翻译服务暂时限流。",
};
class ApiError extends Error {
  constructor(code, status) { super(code); this.code = code; this.status = status; }
}
function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: {
    "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
  } });
}
async function limitedText(message, maximum) {
  if (Number(message.headers.get("content-length")) > maximum) throw new Error("BODY_TOO_LARGE");
  if (!message.body) return "";
  const reader = message.body.getReader(), decoder = new TextDecoder("utf-8", { fatal: true });
  let length = 0, result = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > maximum) throw new Error("BODY_TOO_LARGE");
      result += decoder.decode(value, { stream: true });
    }
    return result + decoder.decode();
  } finally { await reader.cancel().catch(() => {}); }
}
function settings(env) {
  if (env.DEEPSEEK_TRIAL_ENABLED !== TRIAL_ENABLE_VALUE || !env.DB?.prepare ||
    typeof env.ACCESS_TOKEN !== "string" || !/^[A-Za-z0-9_-]{32,256}$/.test(env.ACCESS_TOKEN) ||
    typeof env.DEEPSEEK_API_KEY !== "string" || !env.DEEPSEEK_API_KEY || env.DEEPSEEK_API_KEY.length > 512) {
    throw new ApiError("SERVICE_UNAVAILABLE", 503);
  }
  // Validate header acceptability locally. Never expose or log a rejected value.
  try { new Headers({ Authorization: `Bearer ${env.DEEPSEEK_API_KEY}` }); }
  catch { throw new ApiError("SERVICE_UNAVAILABLE", 503); }
}
async function authorized(request, token) {
  const value = request.headers.get("authorization") ?? "";
  if (value.length > 300) return false;
  const encoder = new TextEncoder();
  const values = await Promise.all([value, `Bearer ${token}`].map((entry) => crypto.subtle.digest("SHA-256", encoder.encode(entry))));
  const left = new Uint8Array(values[0]), right = new Uint8Array(values[1]);
  let difference = 0;
  for (let i = 0; i < left.length; i++) difference |= left[i] ^ right[i];
  return difference === 0;
}

export function createWorker({ fetcher = (...args) => fetch(...args), tokenProof = TOKEN_BOUND_MANIFEST,
  upstreamTimeoutMs = 20000, executionAuthority = CLOUDFLARE_AUTHORITY, onValidatedUsage, onUpstreamStatus, abortSignal } = {}) {
  return { async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (url.protocol !== "https:" || url.pathname !== "/translate" || url.search || request.method !== "POST") {
        throw new ApiError("INVALID_REQUEST", 400);
      }
      settings(env);
      if (!(await authorized(request, env.ACCESS_TOKEN))) throw new ApiError("UNAUTHORIZED", 401);
      if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) throw new ApiError("INVALID_REQUEST", 400);
      let body;
      try { body = JSON.parse(await limitedText(request, BODY_BYTES)); } catch { throw new ApiError("INVALID_REQUEST", 400); }
      if (!body || typeof body.text !== "string" || !body.text.trim() || body.text !== body.text.toWellFormed() ||
        hasUnsupportedLetters(body.text) || typeof body.requestId !== "string" ||
        !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(body.requestId)) {
        throw new ApiError("INVALID_REQUEST", 400);
      }
      if ([...body.text].length > 10000) throw new ApiError("TEXT_TOO_LONG", 422);
      if (!hasHan(body.text)) return json({ requestId: body.requestId, translation: body.text });
      const index = trialIndex(body.text);
      if (index < 0) throw new ApiError("INVALID_REQUEST", 400);
      const payload = JSON.stringify(buildTrialRequest(body.text));
      // Authority is a factory option, never supplied by request headers, body or bindings.
      if (!(await verifyTokenBound(tokenProof, index, payload, Date.now(), executionAuthority))) throw new ApiError("SERVICE_UNAVAILABLE", 503);
      let reserved;
      try { reserved = await reserveTrial(env.DB, index, body.requestId); }
      catch { throw new ApiError("SERVICE_UNAVAILABLE", 503); }
      if (!reserved) throw new ApiError("QUOTA_EXCEEDED", 403);

      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), upstreamTimeoutMs);
      let response, upstream;
      try {
        response = await fetcher("https://api.deepseek.com/chat/completions", {
          method: "POST", redirect: "manual", signal: abortSignal ? AbortSignal.any([controller.signal, abortSignal]) : controller.signal,
          headers: { "Content-Type": "application/json; charset=utf-8", Authorization: `Bearer ${env.DEEPSEEK_API_KEY}` },
          body: payload,
        });
        if (onUpstreamStatus) { try { onUpstreamStatus(response.status); } catch { /* Metadata must not change translation behavior. */ } }
        if (response.status >= 300 && response.status < 400) throw new Error("REDIRECT_REJECTED");
        upstream = JSON.parse(await limitedText(response, RESPONSE_BYTES));
      } catch {
        throw new ApiError(controller.signal.aborted ? "UPSTREAM_TIMEOUT" : "UPSTREAM_ERROR", 502);
      } finally { clearTimeout(timer); }
      if (!response.ok) throw new ApiError(response.status === 429 ? "RATE_LIMITED" : "UPSTREAM_ERROR", response.status === 429 ? 429 : 502);
      const choice = upstream?.choices?.[0], usage = upstream?.usage;
      if (!Array.isArray(upstream?.choices) || upstream.choices.length !== 1 || choice?.finish_reason !== "stop" ||
        choice.message?.role !== "assistant" || choice.message.tool_calls != null ||
        (choice.message.reasoning_content != null && choice.message.reasoning_content !== "") ||
        !usage || !Number.isInteger(usage.prompt_tokens) || usage.prompt_tokens < 1 || usage.prompt_tokens > MAX_INPUT_TOKENS ||
        !Number.isInteger(usage.completion_tokens) || usage.completion_tokens < 1 || usage.completion_tokens > MAX_OUTPUT_TOKENS) {
        throw new ApiError("UPSTREAM_ERROR", 502);
      }
      if (onValidatedUsage) { try { onValidatedUsage({ promptTokens: usage.prompt_tokens, completionTokens: usage.completion_tokens }); } catch { /* Optional local metadata only. */ } }
      let translation;
      try { translation = restoreTranslation(choice.message.content, prepareTrial(body.text).fragments); }
      catch (error) {
        if (error instanceof PreservationError) throw new ApiError("PRESERVATION_FAILED", 502);
        throw error;
      }
      return json({ requestId: body.requestId, translation });
    } catch (error) {
      const failure = error instanceof ApiError ? error : new ApiError("SERVICE_UNAVAILABLE", 503);
      return json({ error: { code: failure.code, message: messages[failure.code] } }, failure.status);
    }
  } };
}
export default createWorker();
