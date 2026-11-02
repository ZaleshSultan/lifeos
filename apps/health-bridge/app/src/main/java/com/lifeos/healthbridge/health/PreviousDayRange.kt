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
    return localDayRange(date, zoneId)
}

fun localDayRange(
    date: LocalDate,
    zoneId: ZoneId = ZoneId.systemDefault(),
): PreviousDayRange = PreviousDayRange(
    date = date,
    start = date.atStartOfDay(zoneId).toInstant(),
    end = date.plusDays(1).atStartOfDay(zoneId).toInstant(),
    zoneId = zoneId,
)

/** Current-day reads stop at now; completed previous days retain their full range. */
fun dayRange(
    date: LocalDate,
    now: Instant = Instant.now(),
    zoneId: ZoneId = ZoneId.systemDefault(),
): PreviousDayRange {
    val full = localDayRange(date, zoneId)
    require(now > full.start) { "Health day has not started" }
    return full.copy(end = minOf(full.end, now))
}

fun todayRange(
    now: Instant = Instant.now(),
    zoneId: ZoneId = ZoneId.systemDefault(),
): PreviousDayRange = dayRange(now.atZone(zoneId).toLocalDate(), now, zoneId)
