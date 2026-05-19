package com.lifeos.healthbridge

import android.app.Application
import com.lifeos.healthbridge.sync.HealthSyncScheduler

class LifeOsHealthBridgeApp : Application() {
    override fun onCreate() {
        super.onCreate()
        HealthSyncScheduler(this).scheduleAllDaily()
    }
}
