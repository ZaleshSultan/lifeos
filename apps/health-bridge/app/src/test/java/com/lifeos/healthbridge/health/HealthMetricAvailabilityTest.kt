package com.lifeos.healthbridge.health

import com.lifeos.healthbridge.model.HealthDayIngestRequest
import com.lifeos.healthbridge.model.HealthMetrics
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class HealthMetricAvailabilityTest {
    @Test fun `revoking sleep and weight while retaining steps cannot invalidate saved source values`() {
        val metrics = HealthMetrics(steps = 3500)
        val payload = HealthDayIngestRequest(
            date = "2026-11-03",
            syncReason = "manual",
            timezone = "Asia/Almaty",
            metrics = metrics,
            workouts = emptyList(),
            samples = emptyList(),
            missing = queriedMissingMetrics(metrics, setOf(HealthReadGroup.STEPS)),
        )
        val json = Json { explicitNulls = false; encodeDefaults = true }
        val encoded = json.parseToJsonElement(json.encodeToString(payload)).jsonObject
        val sentMetrics = encoded.getValue("metrics").jsonObject
        val missing = encoded.getValue("missing").jsonObject
        assertEquals(setOf("steps"), sentMetrics.keys)
        assertEquals(setOf("steps"), missing.keys)
        assertFalse(missing.containsKey("sleep_minutes"))
        assertFalse(missing.containsKey("sleep_stages"))
        assertFalse(missing.containsKey("weight_kg"))
    }

    @Test fun `a genuinely queried missing sleep record retains explicit source correction flags`() {
        val missing = queriedMissingMetrics(HealthMetrics(), setOf(HealthReadGroup.SLEEP))
        assertEquals(setOf("sleep_minutes", "deep_sleep_minutes", "rem_sleep_minutes", "awake_minutes", "sleep_stages"), missing.keys)
        assertTrue(missing.values.all { it })
    }

    @Test fun `unrelated denied types remain omitted when an allowed measurement has no records`() {
        assertEquals(mapOf("weight_kg" to true), queriedMissingMetrics(HealthMetrics(), setOf(HealthReadGroup.WEIGHT)))
        assertTrue(queriedMissingMetrics(HealthMetrics(), emptySet()).isEmpty())
    }
}
