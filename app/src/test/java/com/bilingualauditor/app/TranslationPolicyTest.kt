package com.bilingualauditor.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TranslationPolicyTest {
    @Test fun acceptsTenThousandCodePointsButRejectsOneMore() {
        assertFalse(TranslationPolicy.isTooLong("中".repeat(9_999)))
        assertFalse(TranslationPolicy.isTooLong("中".repeat(10_000)))
        assertTrue(TranslationPolicy.isTooLong("中".repeat(10_001)))
    }

    @Test fun countsSupplementaryCharactersAsOneAndIncludesWhitespaceAndPunctuation() {
        assertEquals(4, TranslationPolicy.count("中😀 \n"))
        assertFalse(TranslationPolicy.isTooLong("😀".repeat(10_000)))
        assertTrue(TranslationPolicy.isTooLong("😀".repeat(10_000) + "."))
    }

    @Test fun bypassIsConservativeAndDetectsSupplementaryHan() {
        assertTrue(TranslationPolicy.canDisplayUnchanged("I use Android Studio.\nhttps://EXAMPLE.com/Test?q=Hi 😀"))
        assertFalse(TranslationPolicy.canDisplayUnchanged(" \n"))
        assertFalse(TranslationPolicy.canDisplayUnchanged("今天 use API"))
        assertFalse(TranslationPolicy.canDisplayUnchanged("こんにちは"))
        assertTrue(TranslationPolicy.containsChinese("𠀀"))
    }

    @Test fun endpointDisallowsPlaintextCredentialsQueryAndRedirectStylePaths() {
        assertTrue(TranslationEndpoint.isValid("https://example.workers.dev/translate"))
        for (url in listOf("http://example.com/translate", "https://user:secret@example.com/translate",
            "https://example.com/translate?token=secret", "https://example.com/translate#fragment",
            "https://example.com/another-path", "not a URL")) {
            assertFalse(url, TranslationEndpoint.isValid(url))
        }
    }

    @Test fun accessCredentialValidationMatchesPrivateProxyContract() {
        assertTrue(TranslationSettings.isValidToken("a".repeat(32)))
        assertTrue(TranslationSettings.isValidToken("AB_cd-12".repeat(32)))
        for (value in listOf("a".repeat(31), "a".repeat(257), "a".repeat(32) + "\nHeader", "a".repeat(32) + " ")) {
            assertFalse(TranslationSettings.isValidToken(value))
        }
    }
}
