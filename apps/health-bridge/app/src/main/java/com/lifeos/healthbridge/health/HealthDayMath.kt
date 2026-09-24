package com.lifeos.healthbridge.health

import java.time.Duration
import java.time.Instant

internal data class HealthInterval(val start: Instant, val end: Instant)

internal enum class SleepStageKind { ASLEEP, DEEP, REM, AWAKE, UNKNOWN }

internal data class SleepStageInterval(val interval: HealthInterval, val kind: SleepStageKind)

internal data class SleepTotals(
    val sleepMinutes: Long?,
    val deepMinutes: Long?,
    val remMinutes: Long?,
    val awakeMinutes: Long?,
)

// Merge before rounding: duplicate providers and sessions crossing midnight must
// not inflate the day. All intervals use the half-open [start, end) convention.
internal fun mergedIntervals(
    intervals: List<HealthInterval>,
    range: PreviousDayRange,
): List<HealthInterval> {
    val clipped = intervals.mapNotNull {
        val start = maxOf(it.start, range.start)
        val end = minOf(it.end, range.end)
        if (start < end) HealthInterval(start, end) else null
    }.sortedBy { it.start }
    val merged = mutableListOf<HealthInterval>()
    for (next in clipped) {
        val previous = merged.lastOrNull()
        if (previous != null && next.start <= previous.end) {
            merged[merged.lastIndex] = HealthInterval(previous.start, maxOf(previous.end, next.end))
        } else {
            merged.add(next)
        }
    }
    return merged
}

internal fun intervalMinutes(intervals: List<HealthInterval>, range: PreviousDayRange): Long =
    mergedIntervals(intervals, range).sumOf { Duration.between(it.start, it.end).seconds } / 60

internal fun sleepTotals(stages: List<SleepStageInterval>, range: PreviousDayRange): SleepTotals {
    val present = stages.filter { it.interval.start < range.end && it.interval.end > range.start }
    fun minutes(kinds: Set<SleepStageKind>): Long? =
        present.filter { it.kind in kinds }.takeIf { it.isNotEmpty() }
            ?.let { intervalMinutes(it.map { stage -> stage.interval }, range) }

    // Session duration includes time in bed. Without stages, sleep is unknown.
    return SleepTotals(
        sleepMinutes = minutes(setOf(SleepStageKind.ASLEEP, SleepStageKind.DEEP, SleepStageKind.REM)),
        deepMinutes = minutes(setOf(SleepStageKind.DEEP)),
        remMinutes = minutes(setOf(SleepStageKind.REM)),
        awakeMinutes = minutes(setOf(SleepStageKind.AWAKE)),
    )
}

internal data class HeartRatePoint(val time: Instant, val beatsPerMinute: Long, val origin: String)

// A real reading per minute keeps the daily request bounded. The daily average
// still comes from Health Connect's aggregate of all readings, not this subset.
internal fun minuteHeartRateSamples(points: List<HeartRatePoint>, range: PreviousDayRange): List<HeartRatePoint> =
    points.filter { it.time >= range.start && it.time < range.end }
        .sortedWith(compareBy<HeartRatePoint> { it.time }.thenBy { it.origin }.thenBy { it.beatsPerMinute })
        .distinctBy { it.time.epochSecond / 60 }

internal data class RecordPage<T>(val records: List<T>, val nextToken: String?)

internal suspend fun <T> readEveryPage(read: suspend (String?) -> RecordPage<T>): List<T> {
    val records = mutableListOf<T>()
    val seenTokens = mutableSetOf<String>()
    var token: String? = null
    do {
        val page = read(token)
        records.addAll(page.records)
        token = page.nextToken?.takeIf { it.isNotEmpty() }
        check(token == null || seenTokens.add(token)) { "Health Connect repeated a page token" }
    } while (token != null)
    return records
}
