package com.lifeos.healthbridge.health

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

val LIFEOS_HEALTH_ZONE: ZoneId = ZoneId.of("Asia/Qyzylorda")

data class LocalDayRange(
    val date: LocalDate,
    val start: Instant,
    val end: Instant,
    val zoneId: ZoneId,
)

fun localDayRange(
    date: LocalDate,
    zoneId: ZoneId = LIFEOS_HEALTH_ZONE,
): LocalDayRange {
    return LocalDayRange(
        date = date,
        start = date.atStartOfDay(zoneId).toInstant(),
        end = date.plusDays(1).atStartOfDay(zoneId).toInstant(),
        zoneId = zoneId,
    )
}

fun today(
    now: Instant = Instant.now(),
    zoneId: ZoneId = LIFEOS_HEALTH_ZONE,
): LocalDate = now.atZone(zoneId).toLocalDate()
