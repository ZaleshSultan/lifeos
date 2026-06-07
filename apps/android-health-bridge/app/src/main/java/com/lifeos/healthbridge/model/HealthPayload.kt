package com.lifeos.healthbridge.model

import kotlinx.serialization.Serializable

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

data class AggregatedHealthDay(
    val date: String,
    val timezone: String,
    val metrics: List<HealthMetricValue>,
    val recordCounts: Map<String, Int>,
) {
    val hasMetrics: Boolean
        get() = metrics.isNotEmpty()
}

data class HealthPreview(
    val days: List<AggregatedHealthDay>,
) {
    val metricCount: Int
        get() = days.sumOf { it.metrics.size }
}
