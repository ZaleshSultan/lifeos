package com.lifeos.healthbridge.sync

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.Data
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import com.lifeos.healthbridge.model.SyncReason
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.util.concurrent.TimeUnit

class HealthSyncScheduler(
    context: Context,
) {
    private val appContext = context.applicationContext
    private val workManager = WorkManager.getInstance(appContext)
    private val constraints = Constraints.Builder()
        .setRequiredNetworkType(NetworkType.CONNECTED)
        .build()

    fun scheduleAllDaily() {
        scheduleAt(
            uniqueName = WORK_NIGHTLY,
            reason = SyncReason.Nightly,
            targetTime = LocalTime.of(0, 1),
        )
        scheduleAt(
            uniqueName = WORK_RETRY,
            reason = SyncReason.Retry,
            targetTime = LocalTime.of(0, 15),
        )
        scheduleAt(
            uniqueName = WORK_MORNING_RECONCILE,
            reason = SyncReason.MorningReconcile,
            targetTime = LocalTime.of(6, 0),
        )
    }

    fun scheduleRetry() {
        scheduleAt(
            uniqueName = WORK_RETRY,
            reason = SyncReason.Retry,
            targetTime = LocalTime.of(0, 15),
        )
    }

    fun scheduleManualSync() {
        enqueue(
            uniqueName = WORK_MANUAL,
            reason = SyncReason.Manual,
            initialDelay = Duration.ZERO,
            existingWorkPolicy = ExistingWorkPolicy.REPLACE,
        )
    }

    fun scheduleNextFor(reason: SyncReason) {
        when (reason) {
            SyncReason.Nightly -> scheduleAt(WORK_NIGHTLY, reason, LocalTime.of(0, 1))
            SyncReason.Retry -> scheduleAt(WORK_RETRY, reason, LocalTime.of(0, 15))
            SyncReason.MorningReconcile -> scheduleAt(WORK_MORNING_RECONCILE, reason, LocalTime.of(6, 0))
            SyncReason.Manual,
            SyncReason.Backfill -> Unit
        }
    }

    private fun scheduleAt(
        uniqueName: String,
        reason: SyncReason,
        targetTime: LocalTime,
        zoneId: ZoneId = ZoneId.systemDefault(),
    ) {
        enqueue(
            uniqueName = uniqueName,
            reason = reason,
            initialDelay = delayUntilNext(targetTime, zoneId),
            existingWorkPolicy = ExistingWorkPolicy.REPLACE,
        )
    }

    private fun enqueue(
        uniqueName: String,
        reason: SyncReason,
        initialDelay: Duration,
        existingWorkPolicy: ExistingWorkPolicy,
    ) {
        val request = OneTimeWorkRequestBuilder<HealthSyncWorker>()
            .setConstraints(constraints)
            .setInputData(
                Data.Builder()
                    .putString(HealthSyncWorker.KEY_SYNC_REASON, reason.wireValue)
                    .build(),
            )
            .setInitialDelay(initialDelay.toMillis().coerceAtLeast(0), TimeUnit.MILLISECONDS)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 15, TimeUnit.MINUTES)
            .build()

        workManager.enqueueUniqueWork(uniqueName, existingWorkPolicy, request)
    }

    private fun delayUntilNext(
        targetTime: LocalTime,
        zoneId: ZoneId,
        now: Instant = Instant.now(),
    ): Duration {
        val zonedNow = now.atZone(zoneId)
        var targetDate = LocalDate.from(zonedNow)

        if (!zonedNow.toLocalTime().isBefore(targetTime)) {
            targetDate = targetDate.plusDays(1)
        }

        return Duration.between(
            zonedNow,
            targetDate.atTime(targetTime).atZone(zoneId),
        )
    }

    private companion object {
        const val WORK_NIGHTLY = "lifeos-health-nightly-00-01"
        const val WORK_RETRY = "lifeos-health-retry-00-15"
        const val WORK_MORNING_RECONCILE = "lifeos-health-morning-reconcile-06-00"
        const val WORK_MANUAL = "lifeos-health-manual"
    }
}
