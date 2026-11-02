package com.lifeos.healthbridge.permissions

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.lifeos.healthbridge.ui.HealthBridgeTheme

class HealthPermissionRationaleActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            HealthBridgeTheme {
                PermissionRationale()
            }
        }
    }
}

@Composable
private fun PermissionRationale() {
    Surface(
        color = MaterialTheme.colorScheme.background,
        modifier = Modifier.fillMaxSize(),
    ) {
        Column(
            modifier = Modifier.padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(
                text = "LifeOS Health Bridge",
                style = MaterialTheme.typography.headlineSmall,
            )
            Text(
                text = "Приложение читает разрешённые тобой показатели сна, пульса, шагов и тренировок из Health Connect и отправляет их в твой личный LifeOS. Фоновое чтение требуется только для автоматической синхронизации.",
                style = MaterialTheme.typography.bodyLarge,
            )
            Text(
                text = "Мы не читаем данные напрямую с часов и не используем закрытые API Xiaomi. Если Mi Fitness не публикует показатель в Health Connect, LifeOS не сможет его получить.",
                style = MaterialTheme.typography.bodyMedium,
            )
        }
    }
}
