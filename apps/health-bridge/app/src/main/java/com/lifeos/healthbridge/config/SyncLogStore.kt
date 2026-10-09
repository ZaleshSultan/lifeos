package com.lifeos.healthbridge.config

import android.content.Context
import java.time.Instant

/** No tokens, location, or raw health records are persisted in the diagnostic log. */
data class SyncLog(
    val timestamp: String,
    val state: String,
    val message: String,
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
        )
    }

    fun write(state: String, message: String) {
        preferences.edit()
            .putString("time", Instant.now().toString())
            .putString("state", state)
            .putString("message", message.take(300))
            .apply()
    }
}
