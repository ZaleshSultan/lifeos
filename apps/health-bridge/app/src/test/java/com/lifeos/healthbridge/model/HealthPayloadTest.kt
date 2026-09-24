package com.lifeos.healthbridge.model

import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class HealthPayloadTest {
    @Test fun `wire payload retains true HR stages workouts and samples without client identity`() {
        val request = HealthDayIngestRequest(
            date = "2026-09-23", syncReason = "manual", timezone = "Asia/Almaty",
            metrics = HealthMetrics(steps = 0, hrvMs = 45.0, deepSleepMinutes = 70, averageHeartRate = 81.0),
            workouts = listOf(HealthWorkout(externalId = "session-1", startedAt = "2026-09-23T10:00:00Z")),
            samples = listOf(HealthSample("heart_rate", "2026-09-23T10:00:00Z", 100.0, "bpm")),
            missing = mapOf("resting_heart_rate" to true),
        )
        val json = Json { explicitNulls = false; encodeDefaults = true }
        val body = json.parseToJsonElement(json.encodeToString(request)).jsonObject
        val metrics = body.getValue("metrics").jsonObject
        assertEquals("0", metrics.getValue("steps").jsonPrimitive.content)
        assertEquals("45.0", metrics.getValue("hrv_ms").jsonPrimitive.content)
        assertEquals("70", metrics.getValue("deep_sleep_minutes").jsonPrimitive.content)
        assertEquals("81.0", metrics.getValue("average_heart_rate").jsonPrimitive.content)
        assertFalse(metrics.containsKey("resting_heart_rate"))
        assertFalse(body.containsKey("user_id"))
        assertEquals("xiaomi_health_connect", body.getValue("source").jsonPrimitive.content)
        assertEquals("session-1", body.getValue("workouts").jsonArray[0].jsonObject.getValue("external_id").jsonPrimitive.content)
        assertEquals(1, body.getValue("samples").jsonArray.size)
    }
}
