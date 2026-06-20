package com.lifeos.healthbridge.api

import com.lifeos.healthbridge.config.BridgeConfig
import com.lifeos.healthbridge.health.AggregatedHealthDay
import com.lifeos.healthbridge.model.HealthMetricValue
import com.lifeos.healthbridge.model.HealthMetricsIngestRequest
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
            HealthMetricsIngestRequest(
                date = day.date,
                timezone = day.timezone,
                metrics = day.normalizedMetrics(),
                raw = mapOf(
                    "sync_reason" to reason.wireValue,
                    "workout_count" to day.workouts.size.toString(),
                    "sample_count" to day.samples.size.toString(),
                ),
            ),
        )
        val connection = (URL("${config.apiBaseUrl}/api/health/ingest").openConnection() as HttpURLConnection)

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

private fun AggregatedHealthDay.normalizedMetrics(): List<HealthMetricValue> = buildList {
    fun add(type: String, value: Number?, unit: String) {
        value?.let { add(HealthMetricValue(type = type, value = it.toDouble(), unit = unit)) }
    }

    add("sleep_minutes", metrics.sleepMinutes, "min")
    add("sleep_score", metrics.sleepScore, "score")
    add("resting_heart_rate", metrics.restingHeartRate, "bpm")
    add("steps", metrics.steps, "steps")
    add("total_energy_kcal", metrics.caloriesBurned, "kcal")
    add("active_energy_kcal", metrics.activeEnergyKcal, "kcal")
    add("workout_minutes", metrics.workoutMinutes, "min")
    add("weight_kg", metrics.weightKg, "kg")
    add("spo2_percent", metrics.spo2Avg, "percent")
}

class LifeOsApiException(
    val status: Int,
    response: String,
) : RuntimeException("LifeOS API request failed with HTTP $status: $response")
