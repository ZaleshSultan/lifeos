package com.lifeos.healthbridge.sync

import android.content.Context
import androidx.health.connect.client.HealthConnectClient
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.lifeos.healthbridge.api.LifeOsApiClient
import com.lifeos.healthbridge.config.SharedPreferencesSecureConfigStore
import com.lifeos.healthbridge.health.HealthAggregator
import com.lifeos.healthbridge.health.HealthConnectBridge
import com.lifeos.healthbridge.health.localDayRange
import com.lifeos.healthbridge.model.SyncReason

class HealthSyncWorker(
    appContext: Context,
    workerParameters: WorkerParameters,
) : CoroutineWorker(appContext, workerParameters) {
    override suspend fun doWork(): Result {
        val reason = inputData.getString(KEY_SYNC_REASON)
            ?.let { raw -> SyncReason.entries.firstOrNull { it.wireValue == raw } }
            ?: SyncReason.Manual
        val config = SharedPreferencesSecureConfigStore(applicationContext).read()

        if (!config.isComplete) {
            return Result.failure()
        }

        val bridge = HealthConnectBridge(applicationContext)

        if (bridge.availability() != HealthConnectClient.SDK_AVAILABLE) {
            return Result.retry()
        }

        if (bridge.missingPermissions().isNotEmpty()) {
            return Result.failure()
        }

        return try {
            val zone = java.time.ZoneId.systemDefault()
            val today = java.time.LocalDate.now(zone)
            // Manual/backfill also repairs existing seven-day trends; scheduled
            // runs sync yesterday and today for overnight sleep reconciliation.
            val offsets = when (reason) {
                SyncReason.Manual, SyncReason.Backfill -> 6L downTo 0L
                else -> 1L downTo 0L
            }
            val aggregator = HealthAggregator(bridge.client())
            val api = LifeOsApiClient()
            for (offset in offsets) {
                val day = aggregator.aggregatePreviousDay(localDayRange(today.minusDays(offset), zone))
                api.postHealthIngest(config = config, reason = reason, day = day)
            }

            HealthSyncScheduler(applicationContext).scheduleNextFor(reason)
            Result.success()
        } catch (_: Exception) {
            if (reason == SyncReason.Retry) {
                Result.failure()
            } else {
                HealthSyncScheduler(applicationContext).scheduleRetry()
                Result.retry()
            }
        }
    }

    companion object {
        const val KEY_SYNC_REASON = "sync_reason"
    }
}
