package com.outcomego.platform

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.content.pm.PackageInstaller
import android.net.Uri
import android.os.Build
import android.provider.Settings
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.Locale
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

sealed interface AndroidUpdateState {
    data object Idle : AndroidUpdateState
    data object Checking : AndroidUpdateState
    data class Available(val manifest: AndroidUpdateManifest) : AndroidUpdateState
    data class Downloading(val manifest: AndroidUpdateManifest, val progress: Int?) : AndroidUpdateState
    data class Ready(val manifest: AndroidUpdateManifest, val apk: File) : AndroidUpdateState
    data class NeedsInstallPermission(val manifest: AndroidUpdateManifest, val apk: File) : AndroidUpdateState
    data class Installing(val manifest: AndroidUpdateManifest) : AndroidUpdateState
    data class UpToDate(val currentVersion: String) : AndroidUpdateState
    data class Error(val message: String) : AndroidUpdateState
}

class AndroidUpdateManager(context: Context) {
    companion object {
        private const val UPDATE_MANIFEST_URL =
            "https://github.com/jingyi0605/OutcomeGo/releases/latest/download/android-update.json"
        private const val PREFERENCES = "outcomego-android-update"
        private const val LAST_CHECK_AT = "last-check-at"
        private const val INSTALL_STATUS = "install-status"
        private const val INSTALL_MESSAGE = "install-message"
        private const val CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000L
        private const val MAX_MANIFEST_BYTES = 256 * 1024L
        private const val MAX_APK_BYTES = 512L * 1024L * 1024L
        private const val ACTION_INSTALL_COMMIT = "com.outcomego.android.UPDATE_INSTALL_COMMIT"
        private const val EXTRA_FILE_PATH = "outcomego.update.file"
    }

    private val appContext = context.applicationContext
    private val preferences = appContext.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val running = AtomicBoolean(false)
    private val _state = MutableStateFlow<AndroidUpdateState>(AndroidUpdateState.Idle)
    val state: StateFlow<AndroidUpdateState> = _state.asStateFlow()

    fun checkIfDue() {
        val lastCheck = preferences.getLong(LAST_CHECK_AT, 0L)
        if (System.currentTimeMillis() - lastCheck >= CHECK_INTERVAL_MS) checkNow()
        restoreInstallStatus()
    }

    fun checkNow() {
        if (!running.compareAndSet(false, true)) return
        _state.value = AndroidUpdateState.Checking
        scope.launch {
            try {
                val manifest = withContext(Dispatchers.IO) { fetchManifest() }
                preferences.edit().putLong(LAST_CHECK_AT, System.currentTimeMillis()).apply()
                val current = currentPackageInfo()
                val currentVersionCode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                    current.longVersionCode
                } else {
                    @Suppress("DEPRECATION")
                    current.versionCode.toLong()
                }
                _state.value = if (manifest.versionCode > currentVersionCode) {
                    AndroidUpdateState.Available(manifest)
                } else {
                    AndroidUpdateState.UpToDate(current.versionName.orEmpty())
                }
            } catch (error: Throwable) {
                _state.value = AndroidUpdateState.Error(error.message ?: "Could not check for updates.")
            } finally {
                running.set(false)
            }
        }
    }

    fun download() {
        val manifest = (state.value as? AndroidUpdateState.Available)?.manifest ?: return
        if (!running.compareAndSet(false, true)) return
        _state.value = AndroidUpdateState.Downloading(manifest, null)
        scope.launch {
            try {
                val apk = withContext(Dispatchers.IO) { downloadAndVerify(manifest) }
                _state.value = AndroidUpdateState.Ready(manifest, apk)
            } catch (error: Throwable) {
                _state.value = AndroidUpdateState.Error(error.message ?: "Could not download the update.")
            } finally {
                running.set(false)
            }
        }
    }

    fun install() {
        val manifest: AndroidUpdateManifest
        val apk: File
        when (val current = state.value) {
            is AndroidUpdateState.Ready -> {
                manifest = current.manifest
                apk = current.apk
            }
            is AndroidUpdateState.NeedsInstallPermission -> {
                manifest = current.manifest
                apk = current.apk
            }
            else -> return
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
            !appContext.packageManager.canRequestPackageInstalls()
        ) {
            _state.value = AndroidUpdateState.NeedsInstallPermission(manifest, apk)
            appContext.startActivity(
                Intent(
                    Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:${appContext.packageName}"),
                ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            )
            return
        }
        scope.launch {
            try {
                installWithPackageInstaller(manifest, apk)
                _state.value = AndroidUpdateState.Installing(manifest)
            } catch (error: Throwable) {
                _state.value = AndroidUpdateState.Error(error.message ?: "Could not start the Android installer.")
            }
        }
    }

    fun close() {
        scope.coroutineContext[Job]?.cancel()
    }

    private fun fetchManifest(): AndroidUpdateManifest {
        val connection = openConnection(UPDATE_MANIFEST_URL)
        return try {
            require(connection.contentLengthLong in -1L..MAX_MANIFEST_BYTES) {
                "The update manifest is too large."
            }
            val raw = connection.inputStream.use { stream ->
                val output = java.io.ByteArrayOutputStream()
                val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
                var total = 0L
                while (true) {
                    val read = stream.read(buffer)
                    if (read < 0) break
                    total += read
                    require(total <= MAX_MANIFEST_BYTES) { "The update manifest is too large." }
                    output.write(buffer, 0, read)
                }
                output.toString(Charsets.UTF_8.name())
            }
            AndroidUpdateManifestVerifier.parseAndVerify(raw, appContext.packageName)
        } finally {
            connection.disconnect()
        }
    }

    private fun downloadAndVerify(manifest: AndroidUpdateManifest): File {
        require(manifest.sizeBytes <= MAX_APK_BYTES) { "The update APK is too large." }
        val directory = File(appContext.cacheDir, "android-updates").apply { mkdirs() }
        val destination = File(directory, "android-${manifest.versionCode}.apk")
        val temporary = File(directory, "${destination.name}.part")
        if (destination.exists() && verifyApk(destination, manifest)) return destination
        temporary.delete()
        val connection = openConnection(manifest.apkUrl)
        try {
            require(connection.contentLengthLong in -1L..MAX_APK_BYTES) { "The update APK is too large." }
            FileOutputStream(temporary).use { output ->
                connection.inputStream.use { input ->
                    val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
                    var total = 0L
                    while (true) {
                        val read = input.read(buffer)
                        if (read < 0) break
                        total += read
                        require(total <= MAX_APK_BYTES) { "The update APK is too large." }
                        output.write(buffer, 0, read)
                        if (manifest.sizeBytes > 0) {
                            val progress = ((total * 100) / manifest.sizeBytes).toInt().coerceIn(0, 100)
                            _state.value = AndroidUpdateState.Downloading(manifest, progress)
                        }
                    }
                }
            }
        } finally {
            connection.disconnect()
        }
        require(temporary.length() == manifest.sizeBytes) {
            "The downloaded APK size does not match the signed manifest."
        }
        require(verifyApk(temporary, manifest)) {
            "The downloaded APK failed checksum or signature verification."
        }
        destination.delete()
        if (!temporary.renameTo(destination)) error("Could not prepare the downloaded APK.")
        return destination
    }

    private fun verifyApk(file: File, manifest: AndroidUpdateManifest): Boolean {
        if (!file.isFile || file.length() != manifest.sizeBytes) return false
        val checksum = MessageDigest.getInstance("SHA-256").let { digest ->
            FileInputStream(file).use { input ->
                val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
                while (true) {
                    val read = input.read(buffer)
                    if (read < 0) break
                    digest.update(buffer, 0, read)
                }
            }
            digest.digest().joinToString("") { "%02x".format(Locale.US, it) }
        }
        if (!checksum.equals(manifest.sha256, ignoreCase = true)) return false
        val packageInfo = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            appContext.packageManager.getPackageArchiveInfo(
                file.absolutePath,
                PackageManager.GET_SIGNING_CERTIFICATES,
            )
        } else {
            @Suppress("DEPRECATION")
            appContext.packageManager.getPackageArchiveInfo(
                file.absolutePath,
                PackageManager.GET_SIGNATURES,
            )
        } ?: return false
        if (packageInfo.packageName != manifest.applicationId) return false
        val signatures = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            packageInfo.signingInfo?.apkContentsSigners.orEmpty()
        } else {
            @Suppress("DEPRECATION")
            packageInfo.signatures.orEmpty()
        }
        if (signatures.size != 1) return false
        val certificateChecksum = MessageDigest.getInstance("SHA-256")
            .digest(signatures.single().toByteArray())
            .joinToString("") { "%02x".format(Locale.US, it) }
        return certificateChecksum.equals(manifest.certificateSha256, ignoreCase = true)
    }

    private fun installWithPackageInstaller(manifest: AndroidUpdateManifest, apk: File) {
        val installer = appContext.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
            setAppPackageName(manifest.applicationId)
        }
        val sessionId = installer.createSession(params)
        val session = installer.openSession(sessionId)
        try {
            FileInputStream(apk).use { input ->
                session.openWrite("base.apk", 0, apk.length()).use { output ->
                    input.copyTo(output)
                    session.fsync(output)
                }
            }
            val callback = Intent(appContext, AndroidUpdateInstallReceiver::class.java)
                .setAction(ACTION_INSTALL_COMMIT)
                .putExtra(EXTRA_FILE_PATH, apk.absolutePath)
            val pendingIntent = PendingIntent.getBroadcast(
                appContext,
                sessionId,
                callback,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE,
            )
            session.commit(pendingIntent.intentSender)
        } finally {
            session.close()
        }
    }

    private fun restoreInstallStatus() {
        val status = preferences.getInt(INSTALL_STATUS, Int.MIN_VALUE)
        if (status == Int.MIN_VALUE) return
        val message = preferences.getString(INSTALL_MESSAGE, null)
        preferences.edit().remove(INSTALL_STATUS).remove(INSTALL_MESSAGE).apply()
        if (status == PackageInstaller.STATUS_SUCCESS) {
            _state.value = AndroidUpdateState.UpToDate(currentPackageInfo().versionName.orEmpty())
        } else if (status != PackageInstaller.STATUS_PENDING_USER_ACTION) {
            _state.value = AndroidUpdateState.Error(message ?: "Android could not install the update.")
        }
    }

    private fun currentPackageInfo(): PackageInfo =
        appContext.packageManager.getPackageInfo(appContext.packageName, 0)

    private fun openConnection(rawUrl: String): HttpURLConnection {
        val connection = URL(rawUrl).openConnection() as HttpURLConnection
        connection.instanceFollowRedirects = true
        connection.connectTimeout = 20_000
        connection.readTimeout = 60_000
        connection.setRequestProperty("Accept", "application/json, application/octet-stream")
        connection.setRequestProperty(
            "User-Agent",
            "OutcomeGo-Android/${currentPackageInfo().versionName.orEmpty()}",
        )
        require(connection.responseCode in 200..299) {
            "Update service returned HTTP ${connection.responseCode}."
        }
        return connection
    }
}
