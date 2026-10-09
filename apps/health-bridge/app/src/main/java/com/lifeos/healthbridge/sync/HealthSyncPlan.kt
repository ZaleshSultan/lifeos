package com.lifeos.healthbridge.sync

import com.lifeos.healthbridge.model.SyncReason
import java.time.LocalDate

/** Explicit sync dates so manual sync is useful immediately, not just tomorrow. */
internal fun syncDates(reason: SyncReason, localToday: LocalDate): List<LocalDate> = when (reason) {
    SyncReason.Manual -> listOf(localToday.minusDays(1), localToday)
    SyncReason.Backfill -> (7 downTo 1).map { localToday.minusDays(it.toLong()) }
    SyncReason.Nightly, SyncReason.Retry, SyncReason.MorningReconcile -> listOf(localToday.minusDays(1))
}
