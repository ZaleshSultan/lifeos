package com.lifeos.healthbridge.model

enum class SyncReason(val wireValue: String) {
    Nightly("nightly_00_01"),
    Retry("retry_00_15"),
    MorningReconcile("morning_reconcile_06_00"),
    Manual("manual"),
    Backfill("backfill"),
}
