package com.lifeos.healthbridge.health

import com.lifeos.healthbridge.model.SyncReason
import com.lifeos.healthbridge.sync.syncDates
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import org.junit.Assert.assertEquals
import org.junit.Test

class HealthSyncPlanTest {
    private val today = LocalDate.parse("2026-10-09")

    @Test fun `manual sends yesterday and today so latest metrics are visible`() {
        assertEquals(listOf(today.minusDays(1), today), syncDates(SyncReason.Manual, today))
    }

    @Test fun `background includes current wake-up day`() {
        assertEquals(listOf(today.minusDays(1), today), syncDates(SyncReason.Nightly, today))
        assertEquals(listOf(today.minusDays(1), today), syncDates(SyncReason.MorningReconcile, today))
    }

    @Test fun `backfill last seven days including current partial day`() {
        assertEquals(7, syncDates(SyncReason.Backfill, today).size)
        assertEquals(today.minusDays(6), syncDates(SyncReason.Backfill, today).first())
        assertEquals(today, syncDates(SyncReason.Backfill, today).last())
    }

    @Test fun `Almaty date advances before UTC midnight`() {
        val instant = Instant.parse("2026-11-02T19:00:00Z")
        assertEquals(LocalDate.parse("2026-11-03"), instant.atZone(com.lifeos.healthbridge.sync.experimentZone).toLocalDate())
    }

    @Test fun `today range ends at now and previous range spans midnight`() {
        val now = Instant.parse("2026-10-09T11:22:00Z")
        val zone = ZoneId.of("UTC")
        assertEquals(now, todayRange(now, zone).end)
        assertEquals(Instant.parse("2026-10-09T00:00:00Z"), todayRange(now, zone).start)
        assertEquals(Instant.parse("2026-10-09T00:00:00Z"), previousDayRange(now, zone).end)
    }
}
