package com.lifeos.healthbridge.config

import android.content.Context
import java.time.Instant

/** No tokens, location, or raw health records are persisted in the diagnostic log. */
data class SyncLog(
    val timestamp: String,
    val state: String,
    val message: String,
    val lastSuccessAt: String? = null,
)

class SyncLogStore(context: Context) {
    private val preferences = context.applicationContext.getSharedPreferences(
        "lifeos_health_sync_status", Context.MODE_PRIVATE,
    )

    fun read(): SyncLog? {
        val timestamp = preferences.getString("time", null) ?: return null
        return SyncLog(
            timestamp,
            preferences.getString("state", "unknown").orEmpty(),
            preferences.getString("message", "").orEmpty(),
            preferences.getString("last_success_time", null),
        )
    }

    fun write(state: String, message: String) {
        val timestamp = Instant.now().toString()
        preferences.edit()
            .putString("time", timestamp)
            .putString("state", state)
            .putString("message", message.take(300))
            .also { if (state == "success") it.putString("last_success_time", timestamp) }
            .apply()
    }
}
