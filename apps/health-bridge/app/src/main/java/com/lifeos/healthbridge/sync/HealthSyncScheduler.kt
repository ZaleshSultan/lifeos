package com.lifeos.healthbridge.sync

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.Data
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import com.lifeos.healthbridge.model.SyncReason
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.util.concurrent.TimeUnit

/** Periodic requests survive errors and reboot; WorkManager times are approximate. */
class HealthSyncScheduler(context: Context) {
    private val workManager = WorkManager.getInstance(context.applicationContext)
    private val constraints = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

    fun scheduleAllDaily() {
        schedulePeriodic(WORK_NIGHTLY, SyncReason.Nightly, LocalTime.of(0, 1))
        schedulePeriodic(WORK_MORNING_RECONCILE, SyncReason.MorningReconcile, LocalTime.of(6, 0))
    }

    private fun schedulePeriodic(name: String, reason: SyncReason, time: LocalTime) {
        val request = PeriodicWorkRequestBuilder<HealthSyncWorker>(24, TimeUnit.HOURS, 15, TimeUnit.MINUTES)
            .setConstraints(constraints)
            .setInputData(Data.Builder().putString(HealthSyncWorker.KEY_SYNC_REASON, reason.wireValue).build())
            .setInitialDelay(delayUntilNext(time).toMillis(), TimeUnit.MILLISECONDS)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 15, TimeUnit.MINUTES)
            .build()
        workManager.enqueueUniquePeriodicWork(name, ExistingPeriodicWorkPolicy.KEEP, request)
    }

    private fun delayUntilNext(targetTime: LocalTime, zone: ZoneId = ZoneId.systemDefault(), now: Instant = Instant.now()): Duration {
        val zonedNow = now.atZone(zone)
        var date = LocalDate.from(zonedNow)
        if (!zonedNow.toLocalTime().isBefore(targetTime)) date = date.plusDays(1)
        return Duration.between(zonedNow, date.atTime(targetTime).atZone(zone))
    }

    companion object {
        private const val WORK_NIGHTLY = "lifeos-health-nightly-v2"
        private const val WORK_MORNING_RECONCILE = "lifeos-health-morning-v2"
    }
}
