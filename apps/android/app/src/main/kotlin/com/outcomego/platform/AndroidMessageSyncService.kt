package com.outcomego.platform

import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.outcomego.android.MainActivity

/**
 * Keeps the process at foreground-service priority while the app is in the background, so the
 * authenticated sync connection stays alive and local notifications can fire without FCM.
 * Without it Android freezes the cached process and every alert lands only when the app is reopened.
 * The service holds no sync logic of its own; it only pins the process.
 */
class AndroidMessageSyncForegroundService : Service() {
    override fun onCreate() {
        super.onCreate()
        NotificationChannels(this).create()
        val notification = notification()
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int = START_NOT_STICKY

    override fun onBind(intent: Intent?): IBinder? = null

    private fun notification(): android.app.Notification {
        val openIntent = PendingIntent.getActivity(
            this,
            8603,
            Intent(this, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        return NotificationCompat.Builder(this, NotificationChannels.SYNC)
            .setSmallIcon(com.outcomego.android.R.drawable.ic_notification)
            .setContentTitle(getString(com.outcomego.android.R.string.message_sync_title))
            .setContentText(getString(com.outcomego.android.R.string.message_sync_text))
            .setContentIntent(openIntent)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .build()
    }

    companion object {
        private const val NOTIFICATION_ID = 8603

        /** Best effort: Android may refuse a foreground start from the background, which must never crash the app. */
        fun start(context: Context) {
            runCatching {
                ContextCompat.startForegroundService(context, Intent(context, AndroidMessageSyncForegroundService::class.java))
            }
        }

        fun stop(context: Context) {
            runCatching { context.stopService(Intent(context, AndroidMessageSyncForegroundService::class.java)) }
        }
    }
}
