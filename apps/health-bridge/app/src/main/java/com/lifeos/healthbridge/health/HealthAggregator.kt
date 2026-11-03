package com.lifeos.healthbridge.health

import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.aggregate.AggregateMetric
import androidx.health.connect.client.permission.HealthPermission
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

    suspend fun aggregatePreviousDay(range: PreviousDayRange): AggregatedHealthDay = aggregateDay(range)

    suspend fun aggregateDay(range: PreviousDayRange, grantedPermissions: Set<String>? = null): AggregatedHealthDay {
        // Caller passes the actual granted set so users can share steps without
        // granting unrelated weight/oxygen/sleep permissions.
        val groupPermissions = mapOf(
            HealthReadGroup.SLEEP to HealthPermission.getReadPermission(SleepSessionRecord::class),
            HealthReadGroup.STEPS to HealthPermission.getReadPermission(StepsRecord::class),
            HealthReadGroup.WEIGHT to HealthPermission.getReadPermission(WeightRecord::class),
            HealthReadGroup.HEART_RATE to HealthPermission.getReadPermission(HeartRateRecord::class),
            HealthReadGroup.RESTING_HEART_RATE to HealthPermission.getReadPermission(RestingHeartRateRecord::class),
            HealthReadGroup.HRV to HealthPermission.getReadPermission(HeartRateVariabilityRmssdRecord::class),
            HealthReadGroup.OXYGEN to HealthPermission.getReadPermission(OxygenSaturationRecord::class),
            HealthReadGroup.ACTIVE_ENERGY to HealthPermission.getReadPermission(ActiveCaloriesBurnedRecord::class),
            HealthReadGroup.TOTAL_ENERGY to HealthPermission.getReadPermission(TotalCaloriesBurnedRecord::class),
            HealthReadGroup.WORKOUT to HealthPermission.getReadPermission(ExerciseSessionRecord::class),
            HealthReadGroup.DISTANCE to HealthPermission.getReadPermission(DistanceRecord::class),
        )
        val queriedGroups = groupPermissions.filterValues {
            grantedPermissions == null || it in grantedPermissions
        }.keys
        fun permitted(group: HealthReadGroup) = group in queriedGroups
        val filter = TimeRangeFilter.between(range.start, range.end)
        val requested = mutableSetOf<AggregateMetric<*>>()
        if (permitted(HealthReadGroup.STEPS)) requested.add(StepsRecord.COUNT_TOTAL)
        if (permitted(HealthReadGroup.TOTAL_ENERGY)) requested.add(TotalCaloriesBurnedRecord.ENERGY_TOTAL)
        if (permitted(HealthReadGroup.ACTIVE_ENERGY)) requested.add(ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL)
        if (permitted(HealthReadGroup.HEART_RATE)) requested.add(HeartRateRecord.BPM_AVG)
        if (permitted(HealthReadGroup.RESTING_HEART_RATE)) requested.add(RestingHeartRateRecord.BPM_AVG)
        if (permitted(HealthReadGroup.DISTANCE)) requested.add(DistanceRecord.DISTANCE_TOTAL)
        if (permitted(HealthReadGroup.WEIGHT)) requested.add(WeightRecord.WEIGHT_AVG)
        val aggregate = if (requested.isNotEmpty()) {
            healthConnectClient.aggregate(AggregateRequest(metrics = requested, timeRangeFilter = filter))
        } else null

        // Include the preceding evening; assign a completed session to its wake-up day.
        val sleepFilter = TimeRangeFilter.between(range.start.minus(Duration.ofDays(1)), range.end)
        val sleepRecords = if (permitted(HealthReadGroup.SLEEP))
            readAll<SleepSessionRecord>(sleepFilter).distinctBy { it.metadata.id } else emptyList()
        val exerciseRecords = if (permitted(HealthReadGroup.WORKOUT))
            readAll<ExerciseSessionRecord>(filter).distinctBy { it.metadata.id } else emptyList()
        val heartRateRecords = if (permitted(HealthReadGroup.HEART_RATE))
            readAll<HeartRateRecord>(filter).distinctBy { it.metadata.id } else emptyList()
        val hrvRecords = if (permitted(HealthReadGroup.HRV))
            readAll<HeartRateVariabilityRmssdRecord>(filter).distinctBy { it.metadata.id } else emptyList()
        val oxygenRecords = if (permitted(HealthReadGroup.OXYGEN))
            readAll<OxygenSaturationRecord>(filter).distinctBy { it.metadata.id } else emptyList()
        val sleep = sleepTotalsForWakeDay(
            sleepRecords.map { session ->
                SleepSessionIntervals(
                    interval = HealthInterval(session.startTime, session.endTime),
                    stages = session.stages.map { stage ->
                        SleepStageInterval(
                            HealthInterval(stage.startTime, stage.endTime),
                            when (stage.stage) {
                                SleepSessionRecord.STAGE_TYPE_SLEEPING, SleepSessionRecord.STAGE_TYPE_LIGHT -> SleepStageKind.ASLEEP
                                SleepSessionRecord.STAGE_TYPE_DEEP -> SleepStageKind.DEEP
                                SleepSessionRecord.STAGE_TYPE_REM -> SleepStageKind.REM
                                SleepSessionRecord.STAGE_TYPE_AWAKE, SleepSessionRecord.STAGE_TYPE_AWAKE_IN_BED,
                                SleepSessionRecord.STAGE_TYPE_OUT_OF_BED -> SleepStageKind.AWAKE
                                else -> SleepStageKind.UNKNOWN
                            },
                        )
                    },
                )
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
            restingHeartRate = aggregate?.get(RestingHeartRateRecord.BPM_AVG)?.toDouble(),
            averageHeartRate = aggregate?.get(HeartRateRecord.BPM_AVG)?.toDouble(),
            hrvMs = hrvRecords.map { it.heartRateVariabilityMillis }.takeIf { it.isNotEmpty() }?.average(),
            spo2Avg = oxygenRecords.map { it.percentage.value }.takeIf { it.isNotEmpty() }?.average(),
            steps = aggregate?.get(StepsRecord.COUNT_TOTAL),
            caloriesBurned = aggregate?.get(TotalCaloriesBurnedRecord.ENERGY_TOTAL)?.inKilocalories,
            activeEnergyKcal = aggregate?.get(ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL)?.inKilocalories,
            workoutMinutes = exerciseRecords.takeIf { it.isNotEmpty() }?.let { records ->
                intervalMinutes(records.map { HealthInterval(it.startTime, it.endTime) }, range)
            },
            distanceMeters = aggregate?.get(DistanceRecord.DISTANCE_TOTAL)?.inMeters,
            weightKg = aggregate?.get(WeightRecord.WEIGHT_AVG)?.inKilograms,
        )
        return AggregatedHealthDay(
            date = range.date.toString(),
            timezone = range.zoneId.id,
            metrics = metrics,
            workouts = workouts,
            samples = samples,
            missing = queriedMissingMetrics(metrics, queriedGroups),
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
