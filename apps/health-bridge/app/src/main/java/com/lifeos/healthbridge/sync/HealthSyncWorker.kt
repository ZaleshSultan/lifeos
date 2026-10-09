package com.lifeos.healthbridge.sync

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.lifeos.healthbridge.model.SyncReason

/** Automated schedule only. Manual sends run in the open Activity as foreground requests. */
class HealthSyncWorker(context: Context, parameters: WorkerParameters) : CoroutineWorker(context, parameters) {
    override suspend fun doWork(): Result {
        val reason = inputData.getString(KEY_SYNC_REASON)
            ?.let { raw -> SyncReason.entries.firstOrNull { it.wireValue == raw } }
            ?: SyncReason.Nightly
        return when (val result = HealthSyncRunner(applicationContext).run(reason, background = true)) {
            is SyncOutcome.Success -> Result.success()
            is SyncOutcome.Failure -> if (result.retry) Result.retry() else Result.failure()
        }
    }

    companion object { const val KEY_SYNC_REASON = "sync_reason" }
}
