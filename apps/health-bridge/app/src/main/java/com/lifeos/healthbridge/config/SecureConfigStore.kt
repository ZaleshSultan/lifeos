package com.lifeos.healthbridge.config

import android.content.Context

data class BridgeConfig(
    val apiBaseUrl: String,
    val sessionToken: String,
) {
    val isComplete: Boolean
        get() = apiBaseUrl.isNotBlank() && sessionToken.isNotBlank()
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
            sessionToken = preferences.getString(KEY_SESSION_TOKEN, null).orEmpty(),
        )
    }

    override fun write(config: BridgeConfig) {
        preferences.edit()
            .putString(KEY_API_BASE_URL, config.apiBaseUrl.trimEnd('/'))
            .putString(KEY_SESSION_TOKEN, config.sessionToken)
            .apply()
    }

    private companion object {
        const val KEY_API_BASE_URL = "api_base_url"
        const val KEY_SESSION_TOKEN = "health_session_token"
    }
}
