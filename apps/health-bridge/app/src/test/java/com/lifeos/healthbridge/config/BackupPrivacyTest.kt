package com.lifeos.healthbridge.config

import java.io.File
import javax.xml.parsers.DocumentBuilderFactory
import org.junit.Assert.assertEquals
import org.junit.Test
import org.w3c.dom.Element

class BackupPrivacyTest {
    private val domains = setOf(
        "root", "file", "database", "sharedpref", "external",
        "device_root", "device_file", "device_database", "device_sharedpref",
    )

    private fun xml(path: String): Element = DocumentBuilderFactory.newInstance()
        .apply { isNamespaceAware = true }
        .newDocumentBuilder().parse(File("src/main/$path")).documentElement

    private fun assertNoAppDataIncluded(mode: Element) {
        assertEquals(0, mode.getElementsByTagName("include").length)
        val exclusions = mode.getElementsByTagName("exclude")
        val excludedDomains = (0 until exclusions.length).map { index ->
            val exclusion = exclusions.item(index) as Element
            assertEquals(".", exclusion.getAttribute("path"))
            exclusion.getAttribute("domain")
        }.toSet()
        assertEquals(domains, excludedDomains)
    }

    @Test fun `credentials and diagnostics are excluded from legacy cloud and device transfers`() {
        val manifest = xml("AndroidManifest.xml")
        val application = manifest.getElementsByTagName("application").item(0) as Element
        val android = "http://schemas.android.com/apk/res/android"
        assertEquals("false", application.getAttributeNS(android, "allowBackup"))
        assertEquals("@xml/backup_rules", application.getAttributeNS(android, "fullBackupContent"))
        assertEquals("@xml/data_extraction_rules", application.getAttributeNS(android, "dataExtractionRules"))

        assertNoAppDataIncluded(xml("res/xml/backup_rules.xml"))
        val modern = xml("res/xml/data_extraction_rules.xml")
        for (mode in listOf("cloud-backup", "device-transfer")) {
            val entries = modern.getElementsByTagName(mode)
            assertEquals(1, entries.length)
            assertNoAppDataIncluded(entries.item(0) as Element)
        }
    }
}
