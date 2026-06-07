package com.lifeos.healthbridge.health

import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.records.ActiveCaloriesBurnedRecord
import androidx.health.connect.client.records.DistanceRecord
import androidx.health.connect.client.records.ExerciseSessionRecord
import androidx.health.connect.client.records.HeartRateRecord
import androidx.health.connect.client.records.OxygenSaturationRecord
import androidx.health.connect.client.records.RestingHeartRateRecord
import androidx.health.connect.client.records.SleepSessionRecord
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.records.TotalCaloriesBurnedRecord
import androidx.health.connect.client.records.WeightRecord
import androidx.health.connect.client.request.AggregateRequest
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import com.lifeos.healthbridge.model.AggregatedHealthDay
import com.lifeos.healthbridge.model.HealthMetricValue
import java.time.Duration
import java.time.LocalDate

class HealthAggregator(private val healthConnectClient: HealthConnectClient) {
    suspend fun aggregate(date: LocalDate): AggregatedHealthDay {
        val range = localDayRange(date)
        val filter = TimeRangeFilter.between(range.start, range.end)
        val aggregate = healthConnectClient.aggregate(
            AggregateRequest(
                metrics = setOf(
                    StepsRecord.COUNT_TOTAL,
                    HeartRateRecord.BPM_AVG,
                    RestingHeartRateRecord.BPM_AVG,
                    ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL,
                    TotalCaloriesBurnedRecord.ENERGY_TOTAL,
                    DistanceRecord.DISTANCE_TOTAL,
                    WeightRecord.WEIGHT_AVG,
                ),
                timeRangeFilter = filter,
            ),
        )
        val sleepRecords = healthConnectClient.readRecords(
            ReadRecordsRequest<SleepSessionRecord>(timeRangeFilter = filter),
        ).records
        val exerciseRecords = healthConnectClient.readRecords(
            ReadRecordsRequest<ExerciseSessionRecord>(timeRangeFilter = filter),
        ).records
        val oxygenRecords = healthConnectClient.readRecords(
            ReadRecordsRequest<OxygenSaturationRecord>(timeRangeFilter = filter),
        ).records
        val metrics = buildList {
            addMetric("steps", aggregate[StepsRecord.COUNT_TOTAL], "steps")
            addMetric(
                "sleep_minutes",
                sleepRecords.sumOf { Duration.between(it.startTime, it.endTime).toMinutes() }
                    .takeIf { it > 0 },
                "min",
            )
            addMetric("resting_heart_rate", aggregate[RestingHeartRateRecord.BPM_AVG], "bpm")
            addMetric("average_heart_rate", aggregate[HeartRateRecord.BPM_AVG], "bpm")
            addMetric(
                "active_energy_kcal",
                aggregate[ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL]?.inKilocalories,
                "kcal",
            )
            addMetric(
                "total_energy_kcal",
                aggregate[TotalCaloriesBurnedRecord.ENERGY_TOTAL]?.inKilocalories,
                "kcal",
            )
            addMetric(
                "workout_minutes",
                exerciseRecords.sumOf { Duration.between(it.startTime, it.endTime).toMinutes() }
                    .takeIf { it > 0 },
                "min",
            )
            addMetric("distance_m", aggregate[DistanceRecord.DISTANCE_TOTAL]?.inMeters, "m")
            addMetric("weight_kg", aggregate[WeightRecord.WEIGHT_AVG]?.inKilograms, "kg")
            addMetric(
                "spo2_percent",
                oxygenRecords.map { it.percentage.value }.average().takeIf { !it.isNaN() },
                "percent",
            )
        }

        return AggregatedHealthDay(
            date = date.toString(),
            timezone = range.zoneId.id,
            metrics = metrics,
            recordCounts = mapOf(
                "sleep_sessions" to sleepRecords.size,
                "exercise_sessions" to exerciseRecords.size,
                "oxygen_samples" to oxygenRecords.size,
            ),
        )
    }
}

private fun MutableList<HealthMetricValue>.addMetric(
    type: String,
    value: Number?,
    unit: String,
) {
    value?.toDouble()?.takeIf { it.isFinite() }?.let {
        add(HealthMetricValue(type = type, value = it, unit = unit))
    }
}
