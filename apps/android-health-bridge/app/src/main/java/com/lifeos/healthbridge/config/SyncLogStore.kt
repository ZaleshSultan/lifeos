package com.lifeos.healthbridge.config

import android.content.Context

class SyncLogStore(context: Context) {
    private val preferences = context.getSharedPreferences(
        "lifeos_android_health_bridge_status",
        Context.MODE_PRIVATE,
    )

    fun read(): String = preferences.getString(KEY_LAST_LOG, null) ?: "No sync attempted yet."

    fun write(message: String) {
        preferences.edit()
            .putString(KEY_LAST_LOG, message.take(2_000))
            .apply()
    }

    private companion object {
        const val KEY_LAST_LOG = "last_sync_log"
    }
}
