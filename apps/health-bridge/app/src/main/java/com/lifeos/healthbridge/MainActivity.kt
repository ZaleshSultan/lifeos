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
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.permission.HealthPermission
import com.lifeos.healthbridge.config.BridgeConfig
import com.lifeos.healthbridge.config.SharedPreferencesSecureConfigStore
import com.lifeos.healthbridge.config.SyncLogStore
import com.lifeos.healthbridge.config.validHealthBridgeUrl
import com.lifeos.healthbridge.health.HealthConnectBridge
import com.lifeos.healthbridge.sync.HealthSyncRunner
import com.lifeos.healthbridge.model.SyncReason
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import com.lifeos.healthbridge.ui.HealthBridgeTheme
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { HealthBridgeTheme { MainScreen() } }
    }
}

@Composable
private fun MainScreen() {
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val configStore = remember { SharedPreferencesSecureConfigStore(context) }
    val logStore = remember { SyncLogStore(context) }
    val bridge = remember { HealthConnectBridge(context) }
    var sending by remember { mutableStateOf(false) }
    var config by remember { mutableStateOf(configStore.read()) }
    var apiBaseUrl by remember { mutableStateOf(config.apiBaseUrl) }
    var sessionToken by remember { mutableStateOf(config.sessionToken) }
    var status by remember { mutableStateOf("Настрой подключение и разреши чтение Health Connect.") }
    var missingPermissionCount by remember { mutableStateOf<Int?>(null) }
    var grantedReadCount by remember { mutableStateOf(0) }
    var backgroundGranted by remember { mutableStateOf(false) }
    var lastSync by remember { mutableStateOf(logStore.read()) }
    val available = bridge.availability() == HealthConnectClient.SDK_AVAILABLE
    val backgroundSupported = available && bridge.backgroundReadSupported()

    suspend fun refreshPermissions() {
        if (available) {
            val granted = bridge.client().permissionController.getGrantedPermissions()
            missingPermissionCount = (bridge.permissions - granted).size
            grantedReadCount = (bridge.permissions intersect granted).size
            backgroundGranted = bridge.backgroundReadGranted()
        }
    }

    val permissionLauncher = rememberLauncherForActivityResult(bridge.permissionContract()) {
        scope.launch { refreshPermissions() }
    }

    LaunchedEffect(available) { refreshPermissions() }

    Surface(color = MaterialTheme.colorScheme.background, modifier = Modifier.fillMaxSize()) {
        Column(
            modifier = Modifier.verticalScroll(rememberScrollState()).padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text("LifeOS · Подключение часов", style = MaterialTheme.typography.headlineMedium)
            Text(
                "Xiaomi Watch → Mi Fitness → Health Connect → LifeOS. " +
                    "Передаются только показатели, доступные в Health Connect.",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Проверка подключения", style = MaterialTheme.typography.titleMedium)
                    Text("Health Connect: ${if (available) "доступен" else "не найден / требует обновления"}")
                    Text("Данные: ${when (missingPermissionCount) {
                        null -> "проверяем разрешения"
                        0 -> "все разрешения на чтение выданы"
                        else -> "разрешено $grantedReadCount, ещё $missingPermissionCount по желанию"
                    }}")
                    Text("Фоновое чтение: ${when {
                        !backgroundSupported -> "не поддерживается на устройстве; синхронизируй вручную"
                        backgroundGranted -> "разрешено"
                        else -> "не разрешено"
                    }}")
                    Text("LifeOS: ${if (config.isComplete) "адрес и токен сохранены" else "не настроен"}")
                    Text(status, color = MaterialTheme.colorScheme.primary)
                }
            }

            Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text("Подключить LifeOS", style = MaterialTheme.typography.titleMedium)
                    Text("В Mini App открой «Здоровье» → «Подключить часы» и получи адрес API и личный токен.")
                    OutlinedTextField(
                        value = apiBaseUrl,
                        onValueChange = { apiBaseUrl = it },
                        label = { Text("HTTPS-адрес API") },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true,
                        isError = apiBaseUrl.isNotBlank() && !validHealthBridgeUrl(apiBaseUrl),
                    )
                    OutlinedTextField(
                        value = sessionToken,
                        onValueChange = { sessionToken = it },
                        label = { Text("Персональный Health-токен") },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true,
                        visualTransformation = PasswordVisualTransformation(),
                    )
                    Button(
                        modifier = Modifier.fillMaxWidth(),
                        enabled = validHealthBridgeUrl(apiBaseUrl) && sessionToken.isNotBlank(),
                        onClick = {
                            try {
                                val newConfig = BridgeConfig(apiBaseUrl.trim().trimEnd('/'), sessionToken.trim())
                                configStore.write(newConfig)
                                config = configStore.read()
                                status = if (config.isComplete) "Подключение сохранено. Токен защищён Android Keystore." else "Не удалось сохранить токен."
                            } catch (_: Exception) {
                                status = "Не удалось безопасно сохранить токен. Проверь настройки телефона."
                            }
                        },
                    ) { Text("Сохранить подключение") }
                }
            }

            Button(
                modifier = Modifier.fillMaxWidth(),
                enabled = available,
                onClick = { permissionLauncher.launch(bridge.permissions) },
            ) { Text("Разрешить доступ к данным здоровья") }
            if (backgroundSupported) {
                OutlinedButton(
                    modifier = Modifier.fillMaxWidth(),
                    enabled = grantedReadCount > 0 && !backgroundGranted,
                    onClick = { permissionLauncher.launch(setOf(HealthPermission.PERMISSION_READ_HEALTH_DATA_IN_BACKGROUND)) },
                ) { Text(if (backgroundGranted) "Фоновое чтение разрешено" else "Разрешить фоновое чтение") }
            }

            Button(
                modifier = Modifier.fillMaxWidth(),
                enabled = config.isComplete && available && grantedReadCount > 0 && !sending,
                onClick = {
                    sending = true
                    status = "Отправляем показатели за вчера и сегодня…"
                    scope.launch {
                        try {
                            val result = withContext(Dispatchers.IO) {
                                HealthSyncRunner(context).run(SyncReason.Manual, background = false)
                            }
                            status = when (result) {
                                is com.lifeos.healthbridge.sync.SyncOutcome.Success -> result.message
                                is com.lifeos.healthbridge.sync.SyncOutcome.Failure -> result.message
                            }
                            lastSync = logStore.read()
                        } finally { sending = false }
                    }
                },
            ) { Text("Отправить данные за сегодня и вчера") }
            OutlinedButton(
                modifier = Modifier.fillMaxWidth(),
                enabled = config.isComplete && available && grantedReadCount > 0 && !sending,
                onClick = {
                    sending = true
                    status = "Загружаем предыдущие 7 дней…"
                    scope.launch {
                        try {
                            val result = withContext(Dispatchers.IO) {
                                HealthSyncRunner(context).run(SyncReason.Backfill, background = false)
                            }
                            status = when (result) {
                                is com.lifeos.healthbridge.sync.SyncOutcome.Success -> result.message
                                is com.lifeos.healthbridge.sync.SyncOutcome.Failure -> result.message
                            }
                            lastSync = logStore.read()
                        } finally { sending = false }
                    }
                },
            ) { Text("Загрузить предыдущие 7 дней") }

            Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Последняя синхронизация", style = MaterialTheme.typography.titleMedium)
                    Text(lastSync?.timestamp.orEmpty().ifBlank { "Ещё не запускалась" })
                    Text(lastSync?.message ?: "После отправки нажми «Обновить результат».")
                    OutlinedButton(modifier = Modifier.fillMaxWidth(), onClick = {
                        lastSync = logStore.read()
                        scope.launch { refreshPermissions() }
                    }) { Text("Обновить результат") }
                }
            }
            Text(
                "Автоматически: примерно после полуночи и утром, когда Android разрешит работу в фоне. " +
                    "Для новых шагов и пульса можно нажимать ручную отправку. " +
                    "Если Health Connect пуст, проверь в Mi Fitness разрешение на передачу данных.",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodySmall,
            )
        }
    }
}
