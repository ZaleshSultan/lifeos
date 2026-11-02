package com.lifeos.healthbridge.config

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SecureConfigTest {
    @Test fun `only HTTPS origins or paths without credentials or query are accepted`() {
        assertTrue(validHealthBridgeUrl("https://lifeos.example"))
        assertTrue(validHealthBridgeUrl("https://lifeos.example/private"))
        listOf("http://lifeos.example", "https://token@lifeos.example", "https://lifeos.example?token=private",
            "https://lifeos.example#private", "file:///private", "invalid").forEach {
            assertFalse(it, validHealthBridgeUrl(it))
        }
    }
}
