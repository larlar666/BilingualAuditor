package com.bilingualauditor.app

/** Product limit is independent of the larger TXT import safety limits. */
object TranslationPolicy {
    const val MAX_CODE_POINTS = 10_000

    fun count(text: String): Int = text.codePointCount(0, text.length)

    fun isTooLong(text: String): Boolean = count(text) > MAX_CODE_POINTS

    fun containsChinese(text: String): Boolean = text.codePoints().anyMatch {
        Character.UnicodeScript.of(it) == Character.UnicodeScript.HAN
    }

    /** A conservative local bypass, not a general language detector. */
    fun canDisplayUnchanged(text: String): Boolean = !text.isBlank() && text.codePoints().allMatch {
        !Character.isLetter(it) || Character.UnicodeScript.of(it) == Character.UnicodeScript.LATIN
    }
}

enum class TranslationMode { GENERIC_HTTPS, TEMP_PC_DEEPSEEK, DEEPSEEK_DIRECT }

/** Kept only in memory. Never contains a provider API key. */
class TranslationSettings(val endpoint: String, val accessToken: String,
    val mode: TranslationMode = TranslationMode.GENERIC_HTTPS, val certificatePin: String = "") {
    val valid: Boolean get() = mode != TranslationMode.DEEPSEEK_DIRECT && TranslationEndpoint.isValid(endpoint) && isValidToken(accessToken) &&
        (mode == TranslationMode.GENERIC_HTTPS || (PinnedTls.isPrivateIpv4(java.net.URI(endpoint).host) &&
            PinnedTls.normalizePin(certificatePin) != null))
    override fun toString(): String = "TranslationSettings(redacted)"

    companion object {
        private val TOKEN_PATTERN = Regex("[A-Za-z0-9_-]{32,256}")
        fun isValidToken(token: String): Boolean = TOKEN_PATTERN.matches(token)
    }
}
