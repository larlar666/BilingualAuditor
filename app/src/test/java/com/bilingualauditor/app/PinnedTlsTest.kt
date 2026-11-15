package com.bilingualauditor.app

import java.security.MessageDigest
import java.security.cert.CertificateException
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate
import org.junit.Assert.*
import org.junit.Test

class PinnedTlsTest {
    private fun cert(name: String) = javaClass.getResourceAsStream("/tls/$name.cer")!!.use {
        CertificateFactory.getInstance("X.509").generateCertificate(it) as X509Certificate
    }
    private fun pin(cert: X509Certificate) = MessageDigest.getInstance("SHA-256").digest(cert.encoded)
        .joinToString("") { "%02x".format(it) }
    private fun rejects(block: () -> Unit) {
        try { block(); fail("Must reject certificate") } catch (_: CertificateException) { }
    }
    @Test fun realDerPinIpSanAndCertificateConstraints() {
        val good = cert("valid")
        PinnedTls.verify(good, "10.1.2.3", pin(good).uppercase().chunked(2).joinToString(": "))
        rejects { PinnedTls.verify(good, "10.1.2.4", pin(good)) }
        rejects { PinnedTls.verify(good, "10.1.2.3", "00".repeat(32)) }
        rejects { PinnedTls.verify(good, "10.1.2.3", "invalid") }
        for (name in listOf("expired", "client", "no-ku")) {
            val bad = cert(name)
            rejects { PinnedTls.verify(bad, "10.1.2.3", pin(bad)) }
        }
    }
    @Test fun tlsChangesAreConnectionLocalAndBoundToExactOrigin() {
        val settings = TranslationSettings("https://10.1.2.3:8765/translate", "a".repeat(32), TranslationMode.TEMP_PC_DEEPSEEK, pin(cert("valid")))
        val globalFactory = javax.net.ssl.HttpsURLConnection.getDefaultSSLSocketFactory()
        val connection = java.net.URL(settings.endpoint).openConnection() as javax.net.ssl.HttpsURLConnection
        val verifier = connection.hostnameVerifier
        PinnedTls.apply(connection, settings)
        assertSame(verifier, connection.hostnameVerifier)
        assertSame(globalFactory, javax.net.ssl.HttpsURLConnection.getDefaultSSLSocketFactory())
        for (url in listOf("https://10.1.2.4:8765/translate", "https://10.1.2.3:8766/translate", "https://10.1.2.3:8765/other")) {
            val other = java.net.URL(url).openConnection() as javax.net.ssl.HttpsURLConnection
            try { PinnedTls.apply(other, settings); fail("Wrong origin/path must reject") }
            catch (error: TranslationFailure) { assertEquals("INVALID_CONFIG", error.code) }
        }
        val legacy = java.net.URL("https://example.com/translate").openConnection() as javax.net.ssl.HttpsURLConnection
        val legacyFactory = legacy.sslSocketFactory
        PinnedTls.apply(legacy, TranslationSettings(legacy.url.toString(), "a".repeat(32)))
        assertSame(legacyFactory, legacy.sslSocketFactory)
    }
    @Test fun phoneConfigurationNeverBroadensToPublicHostsOrUnpinnedEndpoints() {
        val token = "a".repeat(32)
        for (host in listOf("10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.43.1")) {
            assertTrue(TranslationSettings("https://$host:8765/translate", token, TranslationMode.TEMP_PC_DEEPSEEK, "aa".repeat(32)).valid)
        }
        for (host in listOf("example.com", "127.0.0.1", "8.8.8.8", "172.32.0.1", "10.01.2.3", "192.168.1.256")) {
            assertFalse(TranslationSettings("https://$host/translate", token, TranslationMode.TEMP_PC_DEEPSEEK, "aa".repeat(32)).valid)
        }
        assertFalse(TranslationSettings("https://10.1.2.3/translate", token, TranslationMode.TEMP_PC_DEEPSEEK).valid)
        assertTrue(TranslationSettings("https://example.com/translate", token).valid)
        assertEquals("https://10.1.2.3:8765/health", TranslationEndpoint.healthUri("https://10.1.2.3:8765/translate").toString())
    }
}
