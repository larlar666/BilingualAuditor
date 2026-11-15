import { reserveBudget } from "./budget.mjs";
import { hasHan, hasUnsupportedLetters, protect, restore, PreservationError } from "./protection.mjs";

export const MAX_CODE_POINTS = 10000;
const BODY_BYTES = 150000;
const RESPONSE_BYTES = 1000000;
// Temporary, authenticated diagnostics: only constants from these allowlists leave the Worker.
const DIAGNOSTIC_FLAG = "SAFE_ENUMS_V1";
const HTTP_STATUSES = [200, 400, 401, 403, 405, 408, 415, 429, 500, 503];
const AZURE_CODES = [400000, 400001, 400002, 400003, 400004, 400005, 400006,
  400018, 400019, 400020, 400021, 400023, 400035, 400036, 400042, 400043,
  400050, 400064, 400070, 400071, 400072, 400073, 400074, 400075, 400077,
  400079, 400080, 401000, 401015, 403000, 403001, 405000, 408001, 408002,
  415000, 429000, 429001, 429002, 500000, 503000];
function allowedNumber(value, allowed) {
  const match = allowed.find((known) => value === known || value === String(known));
  return match === undefined ? "OTHER" : String(match);
}
function diagnostic(stage, response, upstream) {
  return { stage, httpStatus: allowedNumber(response?.status, HTTP_STATUSES),
    azureCode: allowedNumber(upstream?.error?.code, AZURE_CODES) };
}
const messages = {
  INVALID_REQUEST: "请求格式或文本语言不受支持。", TEXT_TOO_LONG: "文段超出长度范围。",
  UNAUTHORIZED: "访问凭证无效。", RATE_LIMITED: "请求过于频繁，请稍后重试。",
  QUOTA_EXCEEDED: "免费使用额度已用尽。", SERVICE_UNAVAILABLE: "翻译服务暂不可用。",
  UPSTREAM_TIMEOUT: "翻译请求超时。", UPSTREAM_ERROR: "翻译服务未能返回有效结果。",
  PRESERVATION_FAILED: "未能确认原有英文完整保留，请稍后重试。",
  PROTECTION_LIMIT: "原文未超过文段上限，但英文保护处理超出服务安全范围，暂无法翻译此文段。",
};

class ApiError extends Error {
  constructor(code, status, safeDiagnostic) {
    super(code); this.code = code; this.status = status; this.safeDiagnostic = safeDiagnostic;
  }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: {
    "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  } });
}

async function limitedText(message, maximum) {
  if (Number(message.headers.get("content-length")) > maximum) throw new Error("Body too large");
  if (!message.body) return "";
  const reader = message.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let length = 0;
  let text = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > maximum) throw new Error("Body too large");
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally { await reader.cancel().catch(() => {}); }
}

function settings(env) {
  const monthly = Number(env.MONTHLY_CHARACTER_BUDGET);
  const rate = Number(env.REQUESTS_PER_MINUTE);
  // Cap settings rather than silently allowing an operator typo to exhaust F0.
  if (env.AZURE_TIER_CONFIRMED !== "F0" || !env.DB?.prepare ||
    typeof env.ACCESS_TOKEN !== "string" || env.ACCESS_TOKEN.length < 32 || env.ACCESS_TOKEN.length > 256 ||
    !/^[A-Za-z0-9_-]+$/.test(env.ACCESS_TOKEN) ||
    typeof env.AZURE_TRANSLATOR_KEY !== "string" || !env.AZURE_TRANSLATOR_KEY ||
    typeof env.AZURE_TRANSLATOR_REGION !== "string" || !/^[a-z0-9-]{1,40}$/.test(env.AZURE_TRANSLATOR_REGION) ||
    !Number.isInteger(monthly) || monthly < 1 || monthly > 1000000 ||
    !Number.isInteger(rate) || rate < 1 || rate > 6) throw new ApiError("SERVICE_UNAVAILABLE", 503);
  return { monthly, rate };
}

async function authorized(request, token) {
  const authorization = request.headers.get("authorization") ?? "";
  if (authorization.length > 300) return false;
  const encoder = new TextEncoder();
  const [actual, expected] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(authorization)),
    crypto.subtle.digest("SHA-256", encoder.encode(`Bearer ${token}`)),
  ]);
  const left = new Uint8Array(actual), right = new Uint8Array(expected);
  let difference = 0;
  for (let i = 0; i < left.length; i++) difference |= left[i] ^ right[i];
  return difference === 0;
}

export function createWorker({ fetcher = (...args) => fetch(...args), now = () => new Date(), upstreamTimeoutMs = 20000 } = {}) {
  return { async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (url.protocol !== "https:" || url.pathname !== "/translate" || url.search || request.method !== "POST") {
        throw new ApiError("INVALID_REQUEST", 400);
      }
      const config = settings(env);
      if (!(await authorized(request, env.ACCESS_TOKEN))) throw new ApiError("UNAUTHORIZED", 401);
      if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) {
        throw new ApiError("INVALID_REQUEST", 400);
      }
      let body;
      try { body = JSON.parse(await limitedText(request, BODY_BYTES)); }
      catch { throw new ApiError("INVALID_REQUEST", 400); }
      if (!body || typeof body.text !== "string" || !body.text.trim() ||
        typeof body.requestId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.requestId) ||
        body.text !== body.text.toWellFormed() || hasUnsupportedLetters(body.text)) throw new ApiError("INVALID_REQUEST", 400);
      if ([...body.text].length > MAX_CODE_POINTS) throw new ApiError("TEXT_TOO_LONG", 422);
      if (!hasHan(body.text)) return json({ requestId: body.requestId, translation: body.text });

      const protectedInput = protect(body.text);
      // String.length is a conservative UTF-16-unit upper bound for source
      // code points and includes our markup/escaping; use actual sent payload.
      const cost = protectedInput.html.length;
      if (cost > 50000) throw new ApiError("PROTECTION_LIMIT", 422);
      let denied;
      try { denied = await reserveBudget(env.DB, cost, config, now()); }
      catch { throw new ApiError("SERVICE_UNAVAILABLE", 503); }
      if (denied) throw new ApiError(denied, denied === "RATE_LIMITED" ? 429 : 403);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), upstreamTimeoutMs);
      let response, upstream, stage = "transport";
      try {
        response = await fetcher("https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&from=zh-Hans&to=en&textType=html", {
          method: "POST", redirect: "manual", signal: controller.signal,
          headers: { "Content-Type": "application/json; charset=utf-8",
            "Ocp-Apim-Subscription-Key": env.AZURE_TRANSLATOR_KEY,
            "Ocp-Apim-Subscription-Region": env.AZURE_TRANSLATOR_REGION },
          body: JSON.stringify([{ Text: protectedInput.html }]),
        });
        // workerd supports manual/follow, not Node's redirect:"error".
        // Reject redirects before reading any response body or Location header.
        if (response.status >= 300 && response.status < 400) {
          stage = "http";
          throw new Error("Upstream redirect rejected");
        }
        stage = "response_decode";
        upstream = JSON.parse(await limitedText(response, RESPONSE_BYTES));
      } catch (error) {
        throw new ApiError(controller.signal.aborted ? "UPSTREAM_TIMEOUT" : "UPSTREAM_ERROR", 502,
          diagnostic(stage, response));
      } finally { clearTimeout(timer); }
      if (!response.ok) {
        const safeDiagnostic = diagnostic("http", response, upstream);
        if (safeDiagnostic.azureCode === "403001") throw new ApiError("QUOTA_EXCEEDED", 403, safeDiagnostic);
        if (response.status === 429) throw new ApiError("RATE_LIMITED", 429, safeDiagnostic);
        throw new ApiError("UPSTREAM_ERROR", 502, safeDiagnostic);
      }
      if (!Array.isArray(upstream) || upstream.length !== 1 || upstream[0]?.translations?.length !== 1 ||
        upstream[0].translations[0]?.to !== "en") {
        throw new ApiError("UPSTREAM_ERROR", 502, diagnostic("response_shape", response));
      }
      let translation;
      try { translation = restore(upstream[0].translations[0].text, protectedInput.fragments); }
      catch (error) {
        if (error instanceof PreservationError) throw new ApiError("PRESERVATION_FAILED", 502);
        throw error;
      }
      return json({ requestId: body.requestId, translation });
    } catch (error) {
      const failure = error instanceof ApiError ? error : new ApiError("SERVICE_UNAVAILABLE", 503);
      const result = { code: failure.code, message: messages[failure.code] };
      // Only upstream ApiErrors can carry diagnostics; they occur after successful authorization.
      if (env.SAFE_UPSTREAM_DIAGNOSTICS === DIAGNOSTIC_FLAG && failure.safeDiagnostic) {
        result.diagnostic = failure.safeDiagnostic;
      }
      return json({ error: result }, failure.status);
    }
  } };
}

export default createWorker();
