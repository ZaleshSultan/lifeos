package com.lifeos.healthbridge.sync

import android.content.Context
import androidx.health.connect.client.HealthConnectClient
import com.lifeos.healthbridge.api.LifeOsApiClient
import com.lifeos.healthbridge.api.LifeOsApiException
import com.lifeos.healthbridge.config.SharedPreferencesSecureConfigStore
import com.lifeos.healthbridge.config.SyncLogStore
import com.lifeos.healthbridge.health.AggregatedHealthDay
import com.lifeos.healthbridge.health.HealthAggregator
import com.lifeos.healthbridge.health.HealthConnectBridge
import com.lifeos.healthbridge.health.dayRange
import com.lifeos.healthbridge.model.SyncReason
import java.time.Instant
import java.time.ZoneId

sealed interface SyncOutcome {
    data class Success(val message: String) : SyncOutcome
    data class Failure(val message: String, val retry: Boolean = false) : SyncOutcome
}

/** Shared foreground/manual and WorkManager/background sync implementation. */
class HealthSyncRunner(private val context: Context) {
    suspend fun run(reason: SyncReason, background: Boolean): SyncOutcome {
        val log = SyncLogStore(context)
        log.write("running", "Чтение Health Connect…")
        fun fail(message: String, retry: Boolean = false): SyncOutcome.Failure {
            log.write("error", message)
            return SyncOutcome.Failure(message, retry)
        }
        val config = SharedPreferencesSecureConfigStore(context).read()
        if (!config.isComplete) return fail("Настрой HTTPS-адрес и личный токен LifeOS.")
        val bridge = HealthConnectBridge(context)
        if (bridge.availability() != HealthConnectClient.SDK_AVAILABLE)
            return fail("Health Connect недоступен или требует обновления.")
        try {
            val granted = bridge.client().permissionController.getGrantedPermissions()
            if (granted.intersect(bridge.permissions).isEmpty())
                return fail("Разреши хотя бы один показатель в Health Connect.")
            if (background && (!bridge.backgroundReadSupported() || !bridge.backgroundReadGranted()))
                return fail("Нет доступа к Health Connect в фоне. Разреши фон или используй ручную отправку.")

            val now = Instant.now()
            val zone = ZoneId.systemDefault()
            val today = now.atZone(zone).toLocalDate()
            val aggregator = HealthAggregator(bridge.client())
            val api = LifeOsApiClient()
            var sent = 0
            var skipped = 0
            for (date in syncDates(reason, today)) {
                val day = aggregator.aggregateDay(dayRange(date, now, zone), granted)
                if (!day.hasData()) { skipped++; continue }
                api.postHealthIngest(config, reason, day)
                sent++
            }
            if (sent == 0) {
                val message = "Health Connect не содержит данных за эти дни. Проверь, что Mi Fitness пишет данные туда."
                log.write("empty", message)
                return SyncOutcome.Success(message)
            }
            val message = "Передано дней: $sent; без показателей: $skipped. Проверь раздел «Здоровье» в LifeOS."
            log.write("success", message)
            return SyncOutcome.Success(message)
        } catch (error: LifeOsApiException) {
            val message = when (error.status) {
                401, 403 -> "HTTP ${error.status}: обнови личный Health-токен в LifeOS."
                400, 413, 422 -> "HTTP ${error.status}: сервер отклонил данные, проверь версии приложения и API."
                else -> "HTTP ${error.status}: временная ошибка сервера."
            }
            return fail(message, error.status == 429 || error.status >= 500)
        } catch (_: SecurityException) {
            return fail("Health Connect отказал в доступе. Проверь разрешения для приложения.")
        } catch (error: Exception) {
            return fail("Ошибка чтения или сети (${error.javaClass.simpleName}). Попробуй ещё раз.", true)
        }
    }
}

private fun AggregatedHealthDay.hasData(): Boolean {
    val m = metrics
    return workouts.isNotEmpty() || samples.isNotEmpty() || listOf(
        m.sleepMinutes, m.steps, m.restingHeartRate, m.averageHeartRate, m.hrvMs,
        m.spo2Avg, m.activeEnergyKcal, m.caloriesBurned, m.distanceMeters, m.workoutMinutes,
        m.weightKg,
    ).any { it != null }
}
