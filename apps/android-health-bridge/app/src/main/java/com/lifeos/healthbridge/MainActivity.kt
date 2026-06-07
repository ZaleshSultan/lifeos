package com.lifeos.healthbridge

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.health.connect.client.HealthConnectClient
import com.lifeos.healthbridge.api.LifeOsApiClient
import com.lifeos.healthbridge.config.BridgeConfig
import com.lifeos.healthbridge.config.EncryptedConfigStore
import com.lifeos.healthbridge.config.SyncLogStore
import com.lifeos.healthbridge.health.HealthAggregator
import com.lifeos.healthbridge.health.HealthConnectBridge
import com.lifeos.healthbridge.health.today
import com.lifeos.healthbridge.model.AggregatedHealthDay
import com.lifeos.healthbridge.model.HealthPreview
import com.lifeos.healthbridge.ui.HealthBridgeTheme
import java.time.ZonedDateTime
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        setContent {
            HealthBridgeTheme {
                MainScreen()
            }
        }
    }
}

@Composable
private fun MainScreen() {
    val scope = rememberCoroutineScope()
    val context = androidx.compose.ui.platform.LocalContext.current
    val configStore = remember { EncryptedConfigStore(context) }
    val logStore = remember { SyncLogStore(context) }
    val bridge = remember { HealthConnectBridge(context) }
    val apiClient = remember { LifeOsApiClient() }
    var savedConfig by remember { mutableStateOf(configStore.read()) }
    var apiBaseUrl by remember { mutableStateOf(savedConfig.apiBaseUrl) }
    var ingestSecret by remember { mutableStateOf(savedConfig.ingestSecret) }
    var status by remember { mutableStateOf("Ready. Nothing sends automatically.") }
    var lastSyncLog by remember { mutableStateOf(logStore.read()) }
    var missingPermissionCount by remember { mutableStateOf<Int?>(null) }
    var preview by remember { mutableStateOf<HealthPreview?>(null) }
    var busy by remember { mutableStateOf(false) }
    val permissionLauncher = rememberLauncherForActivityResult(
        contract = bridge.permissionContract(),
    ) {
        scope.launch {
            missingPermissionCount = bridge.missingPermissions().size
            status = if (missingPermissionCount == 0) {
                "Health Connect permissions granted."
            } else {
                "Missing $missingPermissionCount Health Connect permissions."
            }
        }
    }

    fun loadPreview(dayCount: Int) {
        scope.launch {
            busy = true
            status = "Reading Health Connect..."

            try {
                if (bridge.availability() != HealthConnectClient.SDK_AVAILABLE) {
                    error("Health Connect is unavailable or needs an update.")
                }

                val missing = bridge.missingPermissions()
                missingPermissionCount = missing.size
                if (missing.isNotEmpty()) {
                    error("Grant all requested Health Connect permissions first.")
                }

                val endDate = today()
                val aggregator = HealthAggregator(bridge.client())
                val days = (dayCount - 1 downTo 0).map { offset ->
                    aggregator.aggregate(endDate.minusDays(offset.toLong()))
                }
                preview = HealthPreview(days)
                status = "Preview ready: ${days.size} day(s), ${preview?.metricCount ?: 0} metrics. Review before sending."
            } catch (error: Exception) {
                status = "Preview failed: ${error.message ?: error::class.simpleName}"
            } finally {
                busy = false
            }
        }
    }

    fun sendPreview() {
        val currentPreview = preview ?: return
        val currentConfig = BridgeConfig(
            apiBaseUrl = apiBaseUrl.trim(),
            ingestSecret = ingestSecret,
        )

        if (!currentConfig.isComplete) {
            status = "Save a valid backend URL and ingest secret before sending."
            return
        }

        scope.launch {
            busy = true
            status = "Sending preview to LifeOS..."

            try {
                configStore.write(currentConfig)
                savedConfig = currentConfig
                val sendableDays = currentPreview.days.filter { it.hasMetrics }
                if (sendableDays.isEmpty()) {
                    error("The preview has no metrics to send.")
                }

                val results = sendableDays.map { day ->
                    apiClient.postHealthIngest(currentConfig, day)
                }
                val message = buildString {
                    append("Success at ")
                    append(ZonedDateTime.now())
                    append('\n')
                    results.forEach { result ->
                        append(result.date)
                        append(": HTTP ")
                        append(result.status)
                        append('\n')
                    }
                    val emptyDays = currentPreview.days.count { !it.hasMetrics }
                    if (emptyDays > 0) {
                        append("Skipped empty days: ")
                        append(emptyDays)
                    }
                }.trim()
                logStore.write(message)
                lastSyncLog = message
                status = "Sent ${results.size} day(s) to LifeOS."
            } catch (error: Exception) {
                val message = "Failed at ${ZonedDateTime.now()}\n${error.message ?: error::class.simpleName}"
                logStore.write(message)
                lastSyncLog = message
                status = "Send failed: ${error.message ?: error::class.simpleName}"
            } finally {
                busy = false
            }
        }
    }

    LaunchedEffect(Unit) {
        if (bridge.availability() == HealthConnectClient.SDK_AVAILABLE) {
            missingPermissionCount = bridge.missingPermissions().size
        }
    }

    Surface(
        color = MaterialTheme.colorScheme.background,
        modifier = Modifier.fillMaxSize(),
    ) {
        Column(
            modifier = Modifier
                .verticalScroll(rememberScrollState())
                .padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text(
                text = "LifeOS Android Health Bridge",
                style = MaterialTheme.typography.headlineMedium,
            )
            Text(
                text = "Xiaomi Watch 4 -> Mi Fitness -> Health Connect -> LifeOS. Manual only in v1.",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodyMedium,
            )

            StatusCard(
                healthConnectStatus = healthConnectStatus(bridge.availability()),
                missingPermissionCount = missingPermissionCount,
                configComplete = savedConfig.isComplete,
                status = status,
            )

            Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
                Column(
                    modifier = Modifier.padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Text("Backend config", style = MaterialTheme.typography.titleMedium)
                    OutlinedTextField(
                        value = apiBaseUrl,
                        onValueChange = { apiBaseUrl = it },
                        label = { Text("Backend URL") },
                        placeholder = { Text("https://archlinux.tail2492c9.ts.net") },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.None),
                    )
                    OutlinedTextField(
                        value = ingestSecret,
                        onValueChange = { ingestSecret = it },
                        label = { Text("Ingest secret") },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true,
                        visualTransformation = PasswordVisualTransformation(),
                    )
                    Text(
                        "Stored locally with Android Keystore-backed encrypted preferences. The secret is never displayed in logs.",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.bodySmall,
                    )
                    Button(
                        modifier = Modifier.fillMaxWidth(),
                        enabled = !busy,
                        onClick = {
                            val config = BridgeConfig(
                                apiBaseUrl = apiBaseUrl.trim(),
                                ingestSecret = ingestSecret,
                            )
                            if (config.isComplete) {
                                configStore.write(config)
                                savedConfig = config
                                status = "Encrypted backend config saved."
                            } else {
                                status = "Enter a valid http(s) backend URL and ingest secret."
                            }
                        },
                    ) {
                        Text("Save encrypted config")
                    }
                }
            }

            Button(
                modifier = Modifier.fillMaxWidth(),
                enabled = !busy && bridge.availability() == HealthConnectClient.SDK_AVAILABLE,
                onClick = { permissionLauncher.launch(bridge.permissions) },
            ) {
                Text("Grant Health Connect permissions")
            }

            Text(
                "Sync buttons read data into a local preview first. Nothing is sent until you tap Send Preview.",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodySmall,
            )
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Button(
                    modifier = Modifier.weight(1f),
                    enabled = !busy,
                    onClick = { loadPreview(1) },
                ) {
                    Text("Sync Today")
                }
                Button(
                    modifier = Modifier.weight(1f),
                    enabled = !busy,
                    onClick = { loadPreview(7) },
                ) {
                    Text("Sync Last 7 Days")
                }
            }

            PreviewCard(preview)

            Button(
                modifier = Modifier.fillMaxWidth(),
                enabled = !busy && preview?.metricCount?.let { it > 0 } == true,
                onClick = { sendPreview() },
            ) {
                Text("Send Preview to LifeOS")
            }

            Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)) {
                Column(
                    modifier = Modifier.padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Text("Last sync status / log", style = MaterialTheme.typography.titleMedium)
                    Text(lastSyncLog, style = MaterialTheme.typography.bodySmall)
                }
            }
        }
    }
}

@Composable
private fun StatusCard(
    healthConnectStatus: String,
    missingPermissionCount: Int?,
    configComplete: Boolean,
    status: String,
) {
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text("Status", style = MaterialTheme.typography.titleMedium)
            Text("Health Connect: $healthConnectStatus")
            Text(
                "Permissions: ${
                    when (missingPermissionCount) {
                        null -> "checking"
                        0 -> "granted"
                        else -> "$missingPermissionCount missing"
                    }
                }",
            )
            Text("Encrypted config: ${if (configComplete) "saved" else "incomplete"}")
            Text(status, color = MaterialTheme.colorScheme.primary)
        }
    }
}

@Composable
private fun PreviewCard(preview: HealthPreview?) {
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text("Metrics preview", style = MaterialTheme.typography.titleMedium)

            if (preview == null) {
                Text(
                    "No preview loaded.",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                return@Column
            }

            Text("${preview.days.size} day(s), ${preview.metricCount} normalized metrics")
            preview.days.forEachIndexed { index, day ->
                if (index > 0) {
                    HorizontalDivider()
                }
                PreviewDay(day)
            }
        }
    }
}

@Composable
private fun PreviewDay(day: AggregatedHealthDay) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(day.date, style = MaterialTheme.typography.titleSmall)
        if (!day.hasMetrics) {
            Text("No available Health Connect data.")
            return
        }

        day.metrics.forEach { metric ->
            Text(
                "${metric.type.replace('_', ' ')}: ${formatMetricValue(metric.value)} ${metric.unit}",
                style = MaterialTheme.typography.bodySmall,
            )
        }
    }
}

private fun healthConnectStatus(status: Int): String {
    return when (status) {
        HealthConnectClient.SDK_AVAILABLE -> "available"
        HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED -> "provider update required"
        else -> "unavailable"
    }
}

private fun formatMetricValue(value: Double): String {
    return if (value % 1.0 == 0.0) {
        value.toLong().toString()
    } else {
        "%.1f".format(value)
    }
}
