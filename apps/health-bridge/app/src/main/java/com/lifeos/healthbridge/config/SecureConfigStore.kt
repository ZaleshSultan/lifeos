package com.lifeos.healthbridge.config

import android.content.Context

data class BridgeConfig(
    val apiBaseUrl: String,
    val ingestSecret: String,
    val lifeOsUserId: String,
) {
    val isComplete: Boolean
        get() = apiBaseUrl.isNotBlank() && ingestSecret.isNotBlank() && lifeOsUserId.isNotBlank()
}

interface SecureConfigStore {
    fun read(): BridgeConfig
    fun write(config: BridgeConfig)
}

class SharedPreferencesSecureConfigStore(
    context: Context,
) : SecureConfigStore {
    private val preferences = context.getSharedPreferences("lifeos_health_bridge_config", Context.MODE_PRIVATE)

    override fun read(): BridgeConfig {
        return BridgeConfig(
            apiBaseUrl = preferences.getString(KEY_API_BASE_URL, null).orEmpty(),
            ingestSecret = preferences.getString(KEY_INGEST_SECRET, null).orEmpty(),
            lifeOsUserId = preferences.getString(KEY_USER_ID, null).orEmpty(),
        )
    }

    override fun write(config: BridgeConfig) {
        preferences.edit()
            .putString(KEY_API_BASE_URL, config.apiBaseUrl.trimEnd('/'))
            .putString(KEY_INGEST_SECRET, config.ingestSecret)
            .putString(KEY_USER_ID, config.lifeOsUserId)
            .apply()
    }

    private companion object {
        const val KEY_API_BASE_URL = "api_base_url"
        const val KEY_INGEST_SECRET = "ingest_secret"
        const val KEY_USER_ID = "lifeos_user_id"
    }
}
