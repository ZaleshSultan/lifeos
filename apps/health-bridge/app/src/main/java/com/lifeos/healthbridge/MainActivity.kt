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
import com.lifeos.healthbridge.config.BridgeConfig
import com.lifeos.healthbridge.config.SharedPreferencesSecureConfigStore
import com.lifeos.healthbridge.health.HealthConnectBridge
import com.lifeos.healthbridge.sync.HealthSyncScheduler
import com.lifeos.healthbridge.ui.HealthBridgeTheme
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
    val configStore = remember { SharedPreferencesSecureConfigStore(context) }
    val bridge = remember { HealthConnectBridge(context) }
    val scheduler = remember { HealthSyncScheduler(context) }
    var config by remember { mutableStateOf(configStore.read()) }
    var apiBaseUrl by remember { mutableStateOf(config.apiBaseUrl) }
    var ingestSecret by remember { mutableStateOf(config.ingestSecret) }
    var userId by remember { mutableStateOf(config.lifeOsUserId) }
    var status by remember { mutableStateOf("Ready") }
    var missingPermissionCount by remember { mutableStateOf<Int?>(null) }
    val permissionLauncher = rememberLauncherForActivityResult(
        contract = bridge.permissionContract(),
    ) {
        scope.launch {
            missingPermissionCount = bridge.missingPermissions().size
            status = if (missingPermissionCount == 0) {
                "Health Connect permissions granted"
            } else {
                "Missing $missingPermissionCount Health Connect permissions"
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
                text = "LifeOS Health Bridge",
                style = MaterialTheme.typography.headlineMedium,
            )
            Text(
                text = "Health Connect only. Previous-day sync to your LifeOS backend.",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodyMedium,
            )

            StatusCard(
                healthConnectAvailable = bridge.availability() == HealthConnectClient.SDK_AVAILABLE,
                missingPermissionCount = missingPermissionCount,
                configComplete = config.isComplete,
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
                        label = { Text("API base URL") },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true,
                    )
                    OutlinedTextField(
                        value = userId,
                        onValueChange = { userId = it },
                        label = { Text("LifeOS user id") },
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
                    Button(
                        modifier = Modifier.fillMaxWidth(),
                        onClick = {
                            config = BridgeConfig(
                                apiBaseUrl = apiBaseUrl.trim(),
                                ingestSecret = ingestSecret,
                                lifeOsUserId = userId.trim(),
                            )
                            configStore.write(config)
                            status = "Config saved"
                        },
                    ) {
                        Text("Save config")
                    }
                }
            }

            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Button(
                    modifier = Modifier.weight(1f),
                    onClick = {
                        permissionLauncher.launch(bridge.permissions)
                    },
                ) {
                    Text("Permissions")
                }
                Button(
                    modifier = Modifier.weight(1f),
                    onClick = {
                        scheduler.scheduleManualSync()
                        status = "Manual sync enqueued"
                    },
                ) {
                    Text("Sync now")
                }
            }

            Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
                Column(
                    modifier = Modifier.padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Text("Schedule", style = MaterialTheme.typography.titleMedium)
                    Text("00:01 nightly previous-day sync")
                    Text("00:15 retry")
                    Text("06:00 morning reconcile")
                    Text("Manual sync from this screen")
                }
            }
        }
    }
}

@Composable
private fun StatusCard(
    healthConnectAvailable: Boolean,
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
            Text("Health Connect: ${if (healthConnectAvailable) "available" else "unavailable"}")
            Text(
                "Permissions: ${
                    when (missingPermissionCount) {
                        null -> "checking"
                        0 -> "granted"
                        else -> "$missingPermissionCount missing"
                    }
                }",
            )
            Text("Config: ${if (configComplete) "saved" else "incomplete"}")
            Text(status, color = MaterialTheme.colorScheme.primary)
        }
    }
}
