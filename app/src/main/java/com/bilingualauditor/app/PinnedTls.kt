package com.bilingualauditor.app

import java.net.URI
import java.security.MessageDigest
import java.security.SecureRandom
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLContext
import javax.net.ssl.X509TrustManager

/** Trust is limited to the explicitly configured private IP and exact leaf DER fingerprint. */
internal object PinnedTls {
    fun normalizePin(value: String): String? = value.replace(Regex("[:\\s]"), "").lowercase()
        .takeIf { it.matches(Regex("[0-9a-f]{64}")) }

    fun isPrivateIpv4(host: String): Boolean {
        val parts = host.split('.')
        if (parts.size != 4 || parts.any { !it.matches(Regex("0|[1-9][0-9]{0,2}")) }) return false
        val octets = parts.map { it.toInt() }
        if (octets.any { it !in 0..255 }) return false
        return octets[0] == 10 || (octets[0] == 172 && octets[1] in 16..31) ||
            (octets[0] == 192 && octets[1] == 168)
    }

    fun verify(certificate: X509Certificate, host: String, pin: String) {
        val normalized = normalizePin(pin) ?: throw CertificateException("Invalid pin")
        if (!isPrivateIpv4(host)) throw CertificateException("Invalid host")
        val expected = normalized.chunked(2).map { it.toInt(16).toByte() }.toByteArray()
        if (!MessageDigest.isEqual(expected, MessageDigest.getInstance("SHA-256").digest(certificate.encoded))) {
            throw CertificateException("Certificate mismatch")
        }
        certificate.checkValidity()
        val eku = certificate.extendedKeyUsage
        if (eku == null || "1.3.6.1.5.5.7.3.1" !in eku) throw CertificateException("Server auth required")
        val usage = certificate.keyUsage
        if (usage == null || usage.isEmpty() || !usage[0]) throw CertificateException("Digital signature required")
        if (certificate.subjectAlternativeNames?.none { it.size >= 2 && it[0] == 7 && it[1] == host } != false) {
            throw CertificateException("IP SAN mismatch")
        }
    }

    fun apply(connection: HttpsURLConnection, settings: TranslationSettings) {
        if (settings.mode != TranslationMode.TEMP_PC_DEEPSEEK) return
        if (!settings.valid || connection.url.toURI() != URI(settings.endpoint) &&
            connection.url.toURI() != TranslationEndpoint.healthUri(settings.endpoint)) throw TranslationFailure("INVALID_CONFIG")
        val host = URI(settings.endpoint).host
        val trust = object : X509TrustManager {
            override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
            override fun checkClientTrusted(chain: Array<X509Certificate>?, authType: String?) {
                throw CertificateException("Client certificates unsupported")
            }
            override fun checkServerTrusted(chain: Array<X509Certificate>?, authType: String?) {
                verify(chain?.firstOrNull() ?: throw CertificateException("Missing certificate"), host, settings.certificatePin)
            }
        }
        connection.sslSocketFactory = SSLContext.getInstance("TLS").apply {
            init(null, arrayOf(trust), SecureRandom())
        }.socketFactory
        // Keep the platform default HTTPS hostname verifier, including its IP SAN verification.
    }
}
