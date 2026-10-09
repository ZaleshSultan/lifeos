package com.lifeos.healthbridge.config

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.net.URI
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

data class BridgeConfig(val apiBaseUrl: String, val sessionToken: String) {
    val isComplete: Boolean get() = apiBaseUrl.isNotBlank() && validHealthBridgeUrl(apiBaseUrl) && sessionToken.isNotBlank()
}

/** Reject cleartext bearer-token transmission. */
fun validHealthBridgeUrl(raw: String): Boolean = try {
    val uri = URI(raw.trim())
    uri.scheme.equals("https", ignoreCase = true) &&
        !uri.host.isNullOrBlank() && uri.userInfo == null &&
        uri.query == null && uri.fragment == null
} catch (_: Exception) { false }

interface SecureConfigStore {
    fun read(): BridgeConfig
    fun write(config: BridgeConfig)
}

/** Android Keystore AES-GCM; migrates the original unencrypted preference on first read. */
class SharedPreferencesSecureConfigStore(context: Context) : SecureConfigStore {
    private val preferences = context.applicationContext.getSharedPreferences(
        "lifeos_health_bridge_config", Context.MODE_PRIVATE,
    )

    override fun read(): BridgeConfig {
        val url = preferences.getString(KEY_API_BASE_URL, null).orEmpty()
        val encrypted = preferences.getString(KEY_ENCRYPTED_TOKEN, null)
        if (encrypted != null) {
            val token = try { decrypt(encrypted) } catch (_: Exception) { "" }
            return BridgeConfig(url, token)
        }
        // One-time migration from older APKs. Never retain plaintext after successful migration.
        val legacy = preferences.getString(KEY_SESSION_TOKEN, null).orEmpty()
        if (legacy.isNotEmpty()) {
            try {
                write(BridgeConfig(url, legacy))
            } catch (_: Exception) {
                return BridgeConfig(url, "")
            }
        }
        return BridgeConfig(url, legacy)
    }

    override fun write(config: BridgeConfig) {
        val encoded = if (config.sessionToken.isNotBlank()) encrypt(config.sessionToken) else null
        preferences.edit()
            .putString(KEY_API_BASE_URL, config.apiBaseUrl.trim().trimEnd('/'))
            .putString(KEY_ENCRYPTED_TOKEN, encoded)
            .remove(KEY_SESSION_TOKEN)
            .apply()
    }

    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(
                KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setUserAuthenticationRequired(false)
                .build())
        }.generateKey()
    }

    private fun encrypt(plain: String): String {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
        val encrypted = cipher.doFinal(plain.toByteArray(Charsets.UTF_8))
        return Base64.encodeToString(cipher.iv + encrypted, Base64.NO_WRAP)
    }

    private fun decrypt(encoded: String): String {
        val raw = Base64.decode(encoded, Base64.DEFAULT)
        require(raw.size > 12 + 16) { "Invalid stored token" }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply {
            init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, raw.copyOfRange(0, 12)))
        }
        return String(cipher.doFinal(raw.copyOfRange(12, raw.size)), Charsets.UTF_8)
    }

    private companion object {
        const val KEY_ALIAS = "lifeos_health_bridge_token_v1"
        const val KEY_API_BASE_URL = "api_base_url"
        const val KEY_SESSION_TOKEN = "health_session_token"
        const val KEY_ENCRYPTED_TOKEN = "health_session_token_encrypted"
    }
}
