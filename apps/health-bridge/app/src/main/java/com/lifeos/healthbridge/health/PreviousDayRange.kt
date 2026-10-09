package com.lifeos.healthbridge.health

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

/** Half-open day in the device timezone; today's range stops at now. */
data class PreviousDayRange(
    val date: LocalDate,
    val start: Instant,
    val end: Instant,
    val zoneId: ZoneId,
)

fun dayRange(date: LocalDate, now: Instant = Instant.now(), zoneId: ZoneId = ZoneId.systemDefault()): PreviousDayRange {
    val start = date.atStartOfDay(zoneId).toInstant()
    val end = minOf(date.plusDays(1).atStartOfDay(zoneId).toInstant(), now)
    require(end > start) { "Day has not started yet" }
    return PreviousDayRange(date, start, end, zoneId)
}

fun previousDayRange(now: Instant = Instant.now(), zoneId: ZoneId = ZoneId.systemDefault()): PreviousDayRange =
    dayRange(now.atZone(zoneId).toLocalDate().minusDays(1), now, zoneId)

fun todayRange(now: Instant = Instant.now(), zoneId: ZoneId = ZoneId.systemDefault()): PreviousDayRange =
    dayRange(now.atZone(zoneId).toLocalDate(), now, zoneId)
