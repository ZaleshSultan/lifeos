package com.lifeos.healthbridge.api

import com.lifeos.healthbridge.config.BridgeConfig
import com.lifeos.healthbridge.health.AggregatedHealthDay
import com.lifeos.healthbridge.model.HealthIngestRequest
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
    },
) {
    suspend fun postHealthIngest(
        config: BridgeConfig,
        reason: SyncReason,
        day: AggregatedHealthDay,
    ) = withContext(Dispatchers.IO) {
        val body = json.encodeToString(
            HealthIngestRequest(
                userId = config.lifeOsUserId,
                date = day.date,
                syncReason = reason.wireValue,
                timezone = day.timezone,
                metrics = day.metrics,
                workouts = day.workouts,
                samples = day.samples,
            ),
        )
        val connection = (URL("${config.apiBaseUrl}/health/ingest").openConnection() as HttpURLConnection)

        connection.requestMethod = "POST"
        connection.connectTimeout = 15_000
        connection.readTimeout = 30_000
        connection.doOutput = true
        connection.setRequestProperty("content-type", "application/json")
        connection.setRequestProperty("x-lifeos-ingest-secret", config.ingestSecret)

        connection.outputStream.use { output ->
            output.write(body.toByteArray(Charsets.UTF_8))
        }

        val status = connection.responseCode
        val responseText = if (status in 200..299) {
            connection.inputStream.bufferedReader().use { it.readText() }
        } else {
            connection.errorStream?.bufferedReader()?.use { it.readText() }.orEmpty()
        }

        if (status !in 200..299) {
            throw LifeOsApiException(status, responseText)
        }
    }
}

class LifeOsApiException(
    val status: Int,
    response: String,
) : RuntimeException("LifeOS API request failed with HTTP $status: $response")
