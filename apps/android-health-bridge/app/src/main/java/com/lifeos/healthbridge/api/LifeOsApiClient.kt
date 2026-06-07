package com.lifeos.healthbridge.api

import com.lifeos.healthbridge.config.BridgeConfig
import com.lifeos.healthbridge.model.AggregatedHealthDay
import com.lifeos.healthbridge.model.HealthMetricsIngestRequest
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.net.HttpURLConnection
import java.net.URL

data class HealthPostResult(
    val date: String,
    val status: Int,
    val response: String,
)

class LifeOsApiClient(
    private val json: Json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
    },
) {
    suspend fun postHealthIngest(
        config: BridgeConfig,
        day: AggregatedHealthDay,
    ): HealthPostResult = withContext(Dispatchers.IO) {
        require(config.isComplete) { "Backend URL and ingest secret are required" }
        require(day.hasMetrics) { "No metrics available for ${day.date}" }

        val body = json.encodeToString(
            HealthMetricsIngestRequest(
                date = day.date,
                timezone = day.timezone,
                metrics = day.metrics,
                raw = day.recordCounts.mapValues { it.value.toString() },
            ),
        )
        val connection = (
            URL("${config.apiBaseUrl.trimEnd('/')}/api/health/ingest")
                .openConnection() as HttpURLConnection
            )

        connection.requestMethod = "POST"
        connection.connectTimeout = 15_000
        connection.readTimeout = 30_000
        connection.doOutput = true
        connection.setRequestProperty("content-type", "application/json")
        connection.setRequestProperty("x-lifeos-health-secret", config.ingestSecret)

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

        HealthPostResult(
            date = day.date,
            status = status,
            response = responseText.take(500),
        )
    }
}

class LifeOsApiException(
    val status: Int,
    response: String,
) : RuntimeException("LifeOS API request failed with HTTP $status: ${response.take(500)}")
