package com.lifeos.healthbridge.health

import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.records.ActiveCaloriesBurnedRecord
import androidx.health.connect.client.records.ExerciseSessionRecord
import androidx.health.connect.client.records.HeartRateRecord
import androidx.health.connect.client.records.HeartRateVariabilityRmssdRecord
import androidx.health.connect.client.records.SleepSessionRecord
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.records.TotalCaloriesBurnedRecord
import androidx.health.connect.client.records.WeightRecord
import androidx.health.connect.client.request.AggregateRequest
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import com.lifeos.healthbridge.model.HealthMetrics
import com.lifeos.healthbridge.model.HealthSample
import com.lifeos.healthbridge.model.HealthWorkout
import java.time.Duration

class HealthAggregator(
    private val healthConnectClient: HealthConnectClient,
) {
    suspend fun aggregatePreviousDay(range: PreviousDayRange): AggregatedHealthDay {
        val filter = TimeRangeFilter.between(range.start, range.end)
        val aggregate = healthConnectClient.aggregate(
            AggregateRequest(
                metrics = setOf(
                    StepsRecord.COUNT_TOTAL,
                    TotalCaloriesBurnedRecord.ENERGY_TOTAL,
                    ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL,
                    HeartRateRecord.BPM_AVG,
                    HeartRateVariabilityRmssdRecord.HEART_RATE_VARIABILITY_RMSSD_AVG,
                    WeightRecord.WEIGHT_AVG,
                ),
                timeRangeFilter = filter,
            ),
        )
        val sleepRecords = healthConnectClient.readRecords(
            ReadRecordsRequest<SleepSessionRecord>(
                timeRangeFilter = filter,
            ),
        ).records
        val exerciseRecords = healthConnectClient.readRecords(
            ReadRecordsRequest<ExerciseSessionRecord>(
                timeRangeFilter = filter,
            ),
        ).records
        val heartRateRecords = healthConnectClient.readRecords(
            ReadRecordsRequest<HeartRateRecord>(
                timeRangeFilter = filter,
            ),
        ).records
        val sleepMinutes = sleepRecords.sumOf {
            Duration.between(it.startTime, it.endTime).toMinutes()
        }.takeIf { it > 0 }
        val workouts = exerciseRecords.map { record ->
            HealthWorkout(
                externalId = record.metadata.id,
                startedAt = record.startTime.toString(),
                endedAt = record.endTime.toString(),
                workoutType = record.exerciseType.toString(),
                title = record.title,
                durationMinutes = Duration.between(record.startTime, record.endTime).toMinutes(),
                source = "health_connect",
            )
        }
        val samples = heartRateRecords.flatMap { record ->
            record.samples.map { sample ->
                HealthSample(
                    sampleType = "heart_rate",
                    sampledAt = sample.time.toString(),
                    value = sample.beatsPerMinute.toDouble(),
                    unit = "bpm",
                    source = "health_connect",
                )
            }
        }

        return AggregatedHealthDay(
            date = range.date.toString(),
            timezone = range.zoneId.id,
            metrics = HealthMetrics(
                sleepMinutes = sleepMinutes,
                restingHeartRate = aggregate[HeartRateRecord.BPM_AVG],
                hrvMs = aggregate[HeartRateVariabilityRmssdRecord.HEART_RATE_VARIABILITY_RMSSD_AVG],
                steps = aggregate[StepsRecord.COUNT_TOTAL],
                caloriesBurned = aggregate[TotalCaloriesBurnedRecord.ENERGY_TOTAL]?.inKilocalories,
                activeEnergyKcal = aggregate[ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL]?.inKilocalories,
                workoutMinutes = workouts.sumOf { it.durationMinutes ?: 0 }.takeIf { it > 0 },
                weightKg = aggregate[WeightRecord.WEIGHT_AVG]?.inKilograms,
            ),
            workouts = workouts,
            samples = samples,
        )
    }
}

data class AggregatedHealthDay(
    val date: String,
    val timezone: String,
    val metrics: HealthMetrics,
    val workouts: List<HealthWorkout>,
    val samples: List<HealthSample>,
)
