package com.lifeos.healthbridge.health

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Test

class HealthDayMathTest {
    private val range = PreviousDayRange(
        LocalDate.parse("2026-09-23"),
        Instant.parse("2026-09-23T00:00:00Z"),
        Instant.parse("2026-09-24T00:00:00Z"),
        ZoneId.of("UTC"),
    )

    private fun interval(start: String, end: String) = HealthInterval(Instant.parse(start), Instant.parse(end))

    @Test fun `sleep clips midnight merges duplicates and excludes awake and unknown`() {
        val deep = SleepStageInterval(interval("2026-09-22T23:30:00Z", "2026-09-23T01:00:00Z"), SleepStageKind.DEEP)
        val result = sleepTotals(listOf(
            deep, deep,
            SleepStageInterval(interval("2026-09-23T01:00:00Z", "2026-09-23T01:30:00Z"), SleepStageKind.AWAKE),
            SleepStageInterval(interval("2026-09-23T01:30:00Z", "2026-09-23T02:00:00Z"), SleepStageKind.UNKNOWN),
            SleepStageInterval(interval("2026-09-23T02:00:00Z", "2026-09-23T03:00:00Z"), SleepStageKind.REM),
        ), range)
        assertEquals(120L, result.sleepMinutes)
        assertEquals(60L, result.deepMinutes)
        assertEquals(60L, result.remMinutes)
        assertEquals(30L, result.awakeMinutes)
    }

    @Test fun `no stages leaves sleep unknown`() {
        assertNull(sleepTotals(emptyList(), range).sleepMinutes)
        assertNull(sleepTotals(emptyList(), range).remMinutes)
    }

    @Test fun `workout total clips boundaries merges overlap and rounds once`() {
        assertEquals(61L, intervalMinutes(listOf(
            interval("2026-09-22T23:00:00Z", "2026-09-23T00:30:30Z"),
            interval("2026-09-23T00:20:00Z", "2026-09-23T01:00:00Z"),
            interval("2026-09-23T23:59:00Z", "2026-09-24T01:00:00Z"),
        ), range))
    }

    @Test fun `heart rate subset keeps real first readings within day regardless input order`() {
        val points = listOf(
            HeartRatePoint(Instant.parse("2026-09-23T00:01:04Z"), 103, "a"),
            HeartRatePoint(Instant.parse("2026-09-23T00:00:07Z"), 83, "b"),
            HeartRatePoint(Instant.parse("2026-09-23T00:00:07Z"), 81, "a"),
            HeartRatePoint(Instant.parse("2026-09-23T00:00:20Z"), 95, "a"),
            HeartRatePoint(range.end, 55, "a"),
        )
        val sampled = minuteHeartRateSamples(points, range)
        assertEquals(listOf(81L, 103L), sampled.map { it.beatsPerMinute })
        assertEquals(sampled, minuteHeartRateSamples(points.reversed(), range))
    }

    @Test fun `overnight sleep belongs entirely to wake date`() {
        val wakeDay = localDayRange(LocalDate.parse("2026-10-10"), ZoneId.of("UTC"))
        val night = interval("2026-10-09T23:14:00Z", "2026-10-10T06:47:00Z")
        val sessions = listOf(SleepSessionIntervals(
            interval = night,
            stages = listOf(SleepStageInterval(night, SleepStageKind.ASLEEP)),
        ))
        assertEquals(453L, sleepTotalsForWakeDay(sessions, wakeDay).sleepMinutes)
        assertNull(sleepTotalsForWakeDay(sessions, localDayRange(LocalDate.parse("2026-10-09"), ZoneId.of("UTC"))).sleepMinutes)
    }

    @Test fun `sleep without stages uses recorded session not fabricated stages`() {
        val wakeDay = localDayRange(LocalDate.parse("2026-10-10"), ZoneId.of("UTC"))
        val result = sleepTotalsForWakeDay(listOf(SleepSessionIntervals(
            interval("2026-10-09T23:14:00Z", "2026-10-10T06:47:00Z"), emptyList(),
        )), wakeDay)
        assertEquals(453L, result.sleepMinutes)
        assertNull(result.deepMinutes)
        assertNull(result.remMinutes)
    }

    @Test fun `sleep stages exclude wake and merge duplicated providers`() {
        val wakeDay = localDayRange(LocalDate.parse("2026-10-10"), ZoneId.of("UTC"))
        val night = interval("2026-10-09T23:00:00Z", "2026-10-10T07:00:00Z")
        val stages = listOf(
            SleepStageInterval(interval("2026-10-09T23:00:00Z", "2026-10-10T03:00:00Z"), SleepStageKind.DEEP),
            SleepStageInterval(interval("2026-10-10T03:00:00Z", "2026-10-10T04:00:00Z"), SleepStageKind.AWAKE),
            SleepStageInterval(interval("2026-10-10T04:00:00Z", "2026-10-10T07:00:00Z"), SleepStageKind.REM),
        )
        val duplicate = SleepSessionIntervals(night, stages)
        val result = sleepTotalsForWakeDay(listOf(duplicate, duplicate), wakeDay)
        assertEquals(420L, result.sleepMinutes)
        assertEquals(240L, result.deepMinutes)
        assertEquals(180L, result.remMinutes)
        assertEquals(60L, result.awakeMinutes)
    }

    @Test fun `pagination follows tokens and accepts empty terminal token`() = runBlocking {
        val seen = mutableListOf<String?>()
        val records = readEveryPage { token ->
            seen.add(token)
            if (token == null) RecordPage(listOf(1, 2), "next") else RecordPage(listOf(3), "")
        }
        assertEquals(listOf(null, "next"), seen)
        assertEquals(listOf(1, 2, 3), records)
    }

    @Test fun `pagination rejects repeated tokens instead of sending incomplete data`() {
        assertThrows(IllegalStateException::class.java) {
            runBlocking { readEveryPage { RecordPage(listOf(1), "same") } }
        }
    }

    @Test fun `local previous day handles daylight saving boundary`() {
        val result = previousDayRange(Instant.parse("2026-03-30T12:00:00Z"), ZoneId.of("Europe/Berlin"))
        assertEquals(LocalDate.parse("2026-03-29"), result.date)
        assertEquals(23L, java.time.Duration.between(result.start, result.end).toHours())
    }
}
