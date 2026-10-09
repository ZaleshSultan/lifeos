package com.lifeos.healthbridge.api

import com.lifeos.healthbridge.config.BridgeConfig
import com.lifeos.healthbridge.health.AggregatedHealthDay
import com.lifeos.healthbridge.model.HealthDayIngestRequest
import com.lifeos.healthbridge.model.SyncReason
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.net.HttpURLConnection
import java.net.URL

class LifeOsApiClient(
    private val json: Json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
        encodeDefaults = true
    },
) {
    suspend fun postHealthIngest(
        config: BridgeConfig,
        reason: SyncReason,
        day: AggregatedHealthDay,
    ) = withContext(Dispatchers.IO) {
        val body = json.encodeToString(
            HealthDayIngestRequest(
                date = day.date,
                syncReason = reason.wireValue,
                timezone = day.timezone,
                metrics = day.metrics,
                workouts = day.workouts,
                samples = day.samples,
                missing = day.missing,
            ),
        )
        val connection = (URL("${config.apiBaseUrl}/api/health/ingest").openConnection() as HttpURLConnection)

        try {
            connection.requestMethod = "POST"
            connection.connectTimeout = 15_000
            connection.readTimeout = 30_000
            connection.doOutput = true
            connection.setRequestProperty("content-type", "application/json")
            connection.setRequestProperty("authorization", "Bearer ${config.sessionToken}")
            connection.outputStream.use { output ->
                output.write(body.toByteArray(Charsets.UTF_8))
            }
            val status = connection.responseCode
            if (status !in 200..299) throw LifeOsApiException(status)
            // Never surface raw server output in UI logs: it can contain metadata.
            connection.inputStream.use { it.readBytes() }
        } finally {
            connection.disconnect()
        }
    }
}

class LifeOsApiException(val status: Int) : RuntimeException("LifeOS API HTTP $status")
