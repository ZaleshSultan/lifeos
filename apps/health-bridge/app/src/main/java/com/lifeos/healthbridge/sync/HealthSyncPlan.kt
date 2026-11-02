package com.lifeos.healthbridge.sync

import com.lifeos.healthbridge.model.SyncReason
import java.time.LocalDate
import java.time.ZoneId

/** Experiment reporting uses the same civil date as the LifeOS dashboard. */
internal val experimentZone: ZoneId = ZoneId.of("Asia/Almaty")

/** Include today on scheduled retries so an overnight session reaches its wake day. */
internal fun syncDates(reason: SyncReason, localToday: LocalDate): List<LocalDate> = when (reason) {
    SyncReason.Manual -> listOf(localToday.minusDays(1), localToday)
    SyncReason.Backfill -> (6 downTo 0).map { localToday.minusDays(it.toLong()) }
    SyncReason.Nightly, SyncReason.Retry, SyncReason.MorningReconcile -> listOf(localToday.minusDays(1), localToday)
}
