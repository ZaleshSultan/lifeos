package com.lifeos.healthbridge.health

import com.lifeos.healthbridge.model.HealthMetrics

internal enum class HealthReadGroup {
    SLEEP, STEPS, WEIGHT, HEART_RATE, RESTING_HEART_RATE, HRV, OXYGEN,
    ACTIVE_ENERGY, TOTAL_ENERGY, WORKOUT, DISTANCE,
}

/** Missing is an authoritative source correction, not a statement about denied access. */
internal fun queriedMissingMetrics(
    metrics: HealthMetrics,
    queried: Set<HealthReadGroup>,
): Map<String, Boolean> = buildMap {
    if (HealthReadGroup.SLEEP in queried) {
        put("sleep_minutes", metrics.sleepMinutes == null)
        put("deep_sleep_minutes", metrics.deepSleepMinutes == null)
        put("rem_sleep_minutes", metrics.remSleepMinutes == null)
        put("awake_minutes", metrics.awakeMinutes == null)
        put("sleep_stages", metrics.deepSleepMinutes == null && metrics.remSleepMinutes == null && metrics.awakeMinutes == null)
    }
    if (HealthReadGroup.STEPS in queried) put("steps", metrics.steps == null)
    if (HealthReadGroup.WEIGHT in queried) put("weight_kg", metrics.weightKg == null)
    if (HealthReadGroup.HEART_RATE in queried) put("average_heart_rate", metrics.averageHeartRate == null)
    if (HealthReadGroup.RESTING_HEART_RATE in queried) put("resting_heart_rate", metrics.restingHeartRate == null)
    if (HealthReadGroup.HRV in queried) put("hrv_ms", metrics.hrvMs == null)
    if (HealthReadGroup.OXYGEN in queried) put("spo2_percent", metrics.spo2Avg == null)
    if (HealthReadGroup.ACTIVE_ENERGY in queried) put("active_energy_kcal", metrics.activeEnergyKcal == null)
    if (HealthReadGroup.TOTAL_ENERGY in queried) put("total_energy_kcal", metrics.caloriesBurned == null)
    if (HealthReadGroup.WORKOUT in queried) put("workout_minutes", metrics.workoutMinutes == null)
    if (HealthReadGroup.DISTANCE in queried) put("distance_m", metrics.distanceMeters == null)
}
