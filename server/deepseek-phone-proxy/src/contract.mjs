export const TRIAL_ID = "deepseek-phone-hotspot-demo-v1";
export const AUTHORITY = "PHONE_HOTSPOT_DEMO_V1";
export const MODEL = "deepseek-flash";
export const LIMITS = Object.freeze({ maxInputCodePoints: 1000, maxAttempts: 20, maxBudgetMicroCny: 3000000 });
export const RESERVATION = 150000;
export const MAX_INPUT_TOKENS = 32768;
export const MAX_OUTPUT_TOKENS = 4096;
export const SESSION_MS = 7200000;
export const STOP_REASONS = Object.freeze(["USER_STOP", "PARENT_EOF", "SESSION_EXPIRED", "INTERRUPTED", "SERVER_ERROR", "START_FAILED", "INPUT_INVALID", "INPUT_TIMEOUT"]);
export const FAILURE_REASONS = Object.freeze(["GATE_FAILED", "INPUT_OR_START_FAILED"]);
export const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export const MESSAGES = Object.freeze({
  INVALID_REQUEST: "请求格式无效。", TEXT_TOO_LONG: "本次演示每次最多 1000 个字符（含空白和标点）。",
  UNAUTHORIZED: "访问凭证无效。", QUOTA_EXCEEDED: "本次演示额度已用完。",
  SERVICE_UNAVAILABLE: "演示代理暂不可用。", PROTECTION_LIMIT: "本段无法在本次保护与计量范围内处理。",
  UPSTREAM_TIMEOUT: "翻译请求超时。", UPSTREAM_ERROR: "翻译服务未能返回有效结果。",
  PRESERVATION_FAILED: "未能确认原有英文完整保留。", RATE_LIMITED: "请稍后再试。",
});
export class ApiError extends Error {
  constructor(code, status = 503) { super(code); this.code = code; this.status = status; }
}
export function budgetView(row) {
  return { ...row, remainingAttempts: LIMITS.maxAttempts - row.attempts,
    remainingReserveMicroCny: LIMITS.maxBudgetMicroCny - row.reservedMicroCny };
}
