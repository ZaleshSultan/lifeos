package com.lifeos.healthbridge.health

import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.records.ActiveCaloriesBurnedRecord
import androidx.health.connect.client.records.DistanceRecord
import androidx.health.connect.client.records.ExerciseSessionRecord
import androidx.health.connect.client.records.HeartRateRecord
import androidx.health.connect.client.records.HeartRateVariabilityRmssdRecord
import androidx.health.connect.client.records.OxygenSaturationRecord
import androidx.health.connect.client.records.Record
import androidx.health.connect.client.records.RestingHeartRateRecord
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

class HealthAggregator(private val healthConnectClient: HealthConnectClient) {
    private suspend inline fun <reified T : Record> readAll(filter: TimeRangeFilter): List<T> =
        readEveryPage { token ->
            val page = healthConnectClient.readRecords(
                ReadRecordsRequest<T>(timeRangeFilter = filter, pageToken = token),
            )
            RecordPage(page.records, page.pageToken)
        }

    suspend fun aggregatePreviousDay(range: PreviousDayRange): AggregatedHealthDay {
        val filter = TimeRangeFilter.between(range.start, range.end)
        val aggregate = healthConnectClient.aggregate(
            AggregateRequest(
                metrics = setOf(
                    StepsRecord.COUNT_TOTAL,
                    TotalCaloriesBurnedRecord.ENERGY_TOTAL,
                    ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL,
                    HeartRateRecord.BPM_AVG,
                    RestingHeartRateRecord.BPM_AVG,
                    DistanceRecord.DISTANCE_TOTAL,
                    WeightRecord.WEIGHT_AVG,
                ),
                timeRangeFilter = filter,
            ),
        )
        val sleepRecords = readAll<SleepSessionRecord>(filter).distinctBy { it.metadata.id }
        val exerciseRecords = readAll<ExerciseSessionRecord>(filter).distinctBy { it.metadata.id }
        val heartRateRecords = readAll<HeartRateRecord>(filter).distinctBy { it.metadata.id }
        val hrvRecords = readAll<HeartRateVariabilityRmssdRecord>(filter).distinctBy { it.metadata.id }
        val oxygenRecords = readAll<OxygenSaturationRecord>(filter).distinctBy { it.metadata.id }
        val sleep = sleepTotals(
            sleepRecords.flatMap { session ->
                session.stages.map { stage ->
                    SleepStageInterval(
                        HealthInterval(maxOf(stage.startTime, session.startTime), minOf(stage.endTime, session.endTime)),
                        when (stage.stage) {
                            SleepSessionRecord.STAGE_TYPE_SLEEPING, SleepSessionRecord.STAGE_TYPE_LIGHT -> SleepStageKind.ASLEEP
                            SleepSessionRecord.STAGE_TYPE_DEEP -> SleepStageKind.DEEP
                            SleepSessionRecord.STAGE_TYPE_REM -> SleepStageKind.REM
                            SleepSessionRecord.STAGE_TYPE_AWAKE, SleepSessionRecord.STAGE_TYPE_AWAKE_IN_BED,
                            SleepSessionRecord.STAGE_TYPE_OUT_OF_BED -> SleepStageKind.AWAKE
                            else -> SleepStageKind.UNKNOWN
                        },
                    )
                }
            },
            range,
        )
        val workouts = exerciseRecords.map { record ->
            HealthWorkout(
                externalId = record.metadata.id,
                startedAt = record.startTime.toString(),
                endedAt = record.endTime.toString(),
                workoutType = "health_connect_${record.exerciseType}",
                title = record.title,
                durationMinutes = Duration.between(record.startTime, record.endTime).toMinutes(),
                source = "health_connect:${record.metadata.dataOrigin.packageName}",
            )
        }
        val points = heartRateRecords.flatMap { record ->
            record.samples.map { HeartRatePoint(it.time, it.beatsPerMinute, record.metadata.dataOrigin.packageName) }
        }
        val samples = minuteHeartRateSamples(points, range).map { sample ->
            HealthSample(
                sampleType = "heart_rate",
                sampledAt = sample.time.toString(),
                value = sample.beatsPerMinute.toDouble(),
                unit = "bpm",
                source = "health_connect:${sample.origin}",
            )
        }
        val metrics = HealthMetrics(
            sleepMinutes = sleep.sleepMinutes,
            deepSleepMinutes = sleep.deepMinutes,
            remSleepMinutes = sleep.remMinutes,
            awakeMinutes = sleep.awakeMinutes,
            restingHeartRate = aggregate[RestingHeartRateRecord.BPM_AVG]?.toDouble(),
            averageHeartRate = aggregate[HeartRateRecord.BPM_AVG]?.toDouble(),
            hrvMs = hrvRecords.map { it.heartRateVariabilityMillis }.takeIf { it.isNotEmpty() }?.average(),
            spo2Avg = oxygenRecords.map { it.percentage.value }.takeIf { it.isNotEmpty() }?.average(),
            steps = aggregate[StepsRecord.COUNT_TOTAL],
            caloriesBurned = aggregate[TotalCaloriesBurnedRecord.ENERGY_TOTAL]?.inKilocalories,
            activeEnergyKcal = aggregate[ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL]?.inKilocalories,
            workoutMinutes = exerciseRecords.takeIf { it.isNotEmpty() }?.let { records ->
                intervalMinutes(records.map { HealthInterval(it.startTime, it.endTime) }, range)
            },
            distanceMeters = aggregate[DistanceRecord.DISTANCE_TOTAL]?.inMeters,
            weightKg = aggregate[WeightRecord.WEIGHT_AVG]?.inKilograms,
        )
        return AggregatedHealthDay(
            date = range.date.toString(),
            timezone = range.zoneId.id,
            metrics = metrics,
            workouts = workouts,
            samples = samples,
            missing = mapOf(
                "sleep_minutes" to (metrics.sleepMinutes == null),
                "deep_sleep_minutes" to (sleep.deepMinutes == null),
                "rem_sleep_minutes" to (sleep.remMinutes == null),
                "awake_minutes" to (sleep.awakeMinutes == null),
                "sleep_stages" to (sleep.deepMinutes == null && sleep.remMinutes == null && sleep.awakeMinutes == null),
                "resting_heart_rate" to (metrics.restingHeartRate == null),
                "average_heart_rate" to (metrics.averageHeartRate == null),
                "hrv_ms" to (metrics.hrvMs == null),
                "spo2_percent" to (metrics.spo2Avg == null),
                "steps" to (metrics.steps == null),
                "active_energy_kcal" to (metrics.activeEnergyKcal == null),
                "total_energy_kcal" to (metrics.caloriesBurned == null),
                "workout_minutes" to (metrics.workoutMinutes == null),
                "distance_m" to (metrics.distanceMeters == null),
                "weight_kg" to (metrics.weightKg == null),
            ),
        )
    }
}

data class AggregatedHealthDay(
    val date: String,
    val timezone: String,
    val metrics: HealthMetrics,
    val workouts: List<HealthWorkout>,
    val samples: List<HealthSample>,
    val missing: Map<String, Boolean> = emptyMap(),
)
