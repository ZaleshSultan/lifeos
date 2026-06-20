package com.lifeos.healthbridge.health

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

data class PreviousDayRange(
    val date: LocalDate,
    val start: Instant,
    val end: Instant,
    val zoneId: ZoneId,
)

fun previousDayRange(
    now: Instant = Instant.now(),
    zoneId: ZoneId = ZoneId.systemDefault(),
): PreviousDayRange {
    val date = now.atZone(zoneId).toLocalDate().minusDays(1)
    return PreviousDayRange(
        date = date,
        start = date.atStartOfDay(zoneId).toInstant(),
        end = date.plusDays(1).atStartOfDay(zoneId).toInstant(),
        zoneId = zoneId,
    )
}
