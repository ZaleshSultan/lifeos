package com.lifeos.healthbridge.config

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

data class BridgeConfig(
    val apiBaseUrl: String,
    val ingestSecret: String,
) {
    val isComplete: Boolean
        get() = apiBaseUrl.startsWith("http") && ingestSecret.isNotBlank()
}

interface SecureConfigStore {
    fun read(): BridgeConfig
    fun write(config: BridgeConfig)
}

class EncryptedConfigStore(context: Context) : SecureConfigStore {
    private val preferences: SharedPreferences = EncryptedSharedPreferences.create(
        context,
        "lifeos_android_health_bridge_config",
        MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    override fun read(): BridgeConfig {
        return BridgeConfig(
            apiBaseUrl = preferences.getString(KEY_API_BASE_URL, null).orEmpty(),
            ingestSecret = preferences.getString(KEY_INGEST_SECRET, null).orEmpty(),
        )
    }

    override fun write(config: BridgeConfig) {
        preferences.edit()
            .putString(KEY_API_BASE_URL, config.apiBaseUrl.trimEnd('/'))
            .putString(KEY_INGEST_SECRET, config.ingestSecret)
            .apply()
    }

    private companion object {
        const val KEY_API_BASE_URL = "api_base_url"
        const val KEY_INGEST_SECRET = "ingest_secret"
    }
}
