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
                text = "This app reads Health Connect activity, sleep, workout, heart, oxygen, and body metrics only after you tap Sync Today or Sync Last 7 Days.",
                style = MaterialTheme.typography.bodyLarge,
            )
            Text(
                text = "You review a local preview before sending. It does not use Samsung Health, scrape Mi Fitness, use Xiaomi private APIs, or send automatically.",
                style = MaterialTheme.typography.bodyMedium,
            )
        }
    }
}
