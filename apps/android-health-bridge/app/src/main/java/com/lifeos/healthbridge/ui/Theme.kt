package com.lifeos.healthbridge.ui

import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val LifeOsDarkColors: ColorScheme = darkColorScheme(
    primary = Color(0xFF22D3EE),
    secondary = Color(0xFF4ADE80),
    tertiary = Color(0xFFFBBF24),
    background = Color(0xFF05070B),
    surface = Color(0xFF0D131D),
    surfaceVariant = Color(0xFF111927),
    onPrimary = Color(0xFF041016),
    onSecondary = Color(0xFF04140A),
    onBackground = Color(0xFFEFF6FF),
    onSurface = Color(0xFFEFF6FF),
)

@Composable
fun HealthBridgeTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = LifeOsDarkColors,
        content = content,
    )
}
