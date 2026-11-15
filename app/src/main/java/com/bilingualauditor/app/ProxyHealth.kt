package com.bilingualauditor.app

import org.json.JSONObject

fun interface ProxyHealthClient {
    suspend fun check(settings: TranslationSettings): ProxyHealth
}

data class ProxyHealth(val ready: Boolean, val attempts: Int, val reservedMicroCny: Int,
    val remainingAttempts: Int, val remainingReserveMicroCny: Int) {
    val display: String get() = "电脑代理已连接（未调用模型）。已认领 $attempts / 20 次，已预留 ${reservedMicroCny / 1_000_000.0} / 3 元；剩余 $remainingAttempts 次、可预留 ${remainingReserveMicroCny / 1_000_000.0} 元。" +
        if (ready) "代理策略就绪；模型可用性仍需实际翻译验证。" else "代理策略未就绪，请在电脑检查策略或会话有效期。"

    companion object {
        fun parse(json: JSONObject): ProxyHealth {
            fun invalid(): Nothing = throw TranslationFailure("INVALID_RESPONSE")
            fun number(obj: JSONObject, key: String, max: Int): Int {
                val value = obj.opt(key)
                if (value !is Int && value !is Long) invalid()
                val n = (value as Number).toLong()
                if (n !in 0..max.toLong()) invalid()
                return n.toInt()
            }
            if (json.opt("status") != "ok" || json.opt("service") != "bilingual-auditor-phone-proxy" ||
                json.opt("translationReady") !is Boolean) invalid()
            val limits = json.optJSONObject("limits") ?: invalid()
            if (number(limits, "maxInputCodePoints", 1000) != 1000 || number(limits, "maxAttempts", 20) != 20 ||
                number(limits, "maxBudgetMicroCny", 3_000_000) != 3_000_000) invalid()
            val budget = json.optJSONObject("budget") ?: invalid()
            val attempts = number(budget, "attempts", 20)
            val reserve = number(budget, "reservedMicroCny", 3_000_000)
            val remaining = number(budget, "remainingAttempts", 20)
            val remainingReserve = number(budget, "remainingReserveMicroCny", 3_000_000)
            if (attempts + remaining != 20 || reserve + remainingReserve != 3_000_000) invalid()
            for (key in listOf("policyExpiresAt", "sessionExpiresAt")) {
                val expiry = json.opt(key)
                if (expiry !is String || runCatching { java.time.Instant.parse(expiry) }.isFailure) invalid()
            }
            return ProxyHealth(json.getBoolean("translationReady"), attempts, reserve, remaining, remainingReserve)
        }
    }
}
