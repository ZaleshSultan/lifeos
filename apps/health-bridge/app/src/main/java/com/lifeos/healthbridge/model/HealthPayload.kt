package com.lifeos.healthbridge.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class HealthMetrics(
    @SerialName("sleep_minutes") val sleepMinutes: Long? = null,
    @SerialName("sleep_score") val sleepScore: Double? = null,
    @SerialName("deep_sleep_minutes") val deepSleepMinutes: Long? = null,
    @SerialName("rem_sleep_minutes") val remSleepMinutes: Long? = null,
    @SerialName("awake_minutes") val awakeMinutes: Long? = null,
    @SerialName("resting_heart_rate") val restingHeartRate: Double? = null,
    @SerialName("hrv_ms") val hrvMs: Double? = null,
    @SerialName("spo2_avg") val spo2Avg: Double? = null,
    val steps: Long? = null,
    @SerialName("calories_burned") val caloriesBurned: Double? = null,
    @SerialName("active_energy_kcal") val activeEnergyKcal: Double? = null,
    @SerialName("workout_minutes") val workoutMinutes: Long? = null,
    @SerialName("weight_kg") val weightKg: Double? = null,
)

@Serializable
data class HealthWorkout(
    @SerialName("external_id") val externalId: String? = null,
    @SerialName("started_at") val startedAt: String,
    @SerialName("ended_at") val endedAt: String? = null,
    @SerialName("workout_type") val workoutType: String? = null,
    val title: String? = null,
    @SerialName("duration_minutes") val durationMinutes: Long? = null,
    @SerialName("calories_kcal") val caloriesKcal: Double? = null,
    @SerialName("distance_meters") val distanceMeters: Double? = null,
    val source: String = "health_connect",
)

@Serializable
data class HealthSample(
    @SerialName("sample_type") val sampleType: String,
    @SerialName("sampled_at") val sampledAt: String,
    val value: Double,
    val unit: String,
    val source: String = "health_connect",
)

@Serializable
data class HealthMetricValue(
    val type: String,
    val value: Double,
    val unit: String,
)

@Serializable
data class HealthMetricsIngestRequest(
    val date: String,
    val source: String = "xiaomi_health_connect",
    val device: String = "Xiaomi Watch 4",
    val timezone: String,
    val metrics: List<HealthMetricValue>,
    val raw: Map<String, String> = emptyMap(),
)

@Serializable
data class HealthIngestResponse(
    val ok: Boolean,
)
