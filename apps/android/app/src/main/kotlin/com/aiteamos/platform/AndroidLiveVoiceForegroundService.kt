package com.aiteamos.platform

import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.aiteamos.android.MainActivity
import com.aiteamos.android.data.HttpMobileGateway
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * Keeps the realtime voice transport and microphone alive while the app is
 * backgrounded or the display is off. The notification is the user-visible
 * ongoing-call affordance and provides the explicit stop action.
 */
object AndroidLiveVoiceForeground {
    const val ACTION_START = "com.aiteamos.android.action.START_LIVE_VOICE"
    const val ACTION_STOP = "com.aiteamos.android.action.STOP_LIVE_VOICE"
    const val ACTION_MICROPHONE = "com.aiteamos.android.action.MUTE_LIVE_VOICE_MICROPHONE"
    const val ACTION_SPEAKER = "com.aiteamos.android.action.MUTE_LIVE_VOICE_SPEAKER"
    const val EXTRA_BOT_ID = "botId"
    const val EXTRA_CHANNEL_ID = "channelId"
    const val EXTRA_MUTED = "muted"

    private val mutableSnapshot = MutableStateFlow(AndroidLiveVoiceSnapshot())
    val snapshot: StateFlow<AndroidLiveVoiceSnapshot> = mutableSnapshot.asStateFlow()
    private val mutableConversationId = MutableStateFlow<String?>(null)
    val conversationId: StateFlow<String?> = mutableConversationId.asStateFlow()

    fun start(context: Context, botId: String, channelId: String) {
        val intent = Intent(context, AndroidLiveVoiceForegroundService::class.java).apply {
            action = ACTION_START
            putExtra(EXTRA_BOT_ID, botId)
            putExtra(EXTRA_CHANNEL_ID, channelId)
        }
        ContextCompat.startForegroundService(context, intent)
    }

    fun stop(context: Context) {
        context.startService(Intent(context, AndroidLiveVoiceForegroundService::class.java).apply {
            action = ACTION_STOP
        })
    }

    fun setMicrophoneMuted(context: Context, muted: Boolean) {
        context.startService(Intent(context, AndroidLiveVoiceForegroundService::class.java).apply {
            action = ACTION_MICROPHONE
            putExtra(EXTRA_MUTED, muted)
        })
    }

    fun setSpeakerMuted(context: Context, muted: Boolean) {
        context.startService(Intent(context, AndroidLiveVoiceForegroundService::class.java).apply {
            action = ACTION_SPEAKER
            putExtra(EXTRA_MUTED, muted)
        })
    }

    internal fun publish(snapshot: AndroidLiveVoiceSnapshot) {
        mutableSnapshot.value = snapshot
    }

    internal fun publishConversationId(id: String?) {
        mutableConversationId.value = id
    }

    internal fun publishError(message: String, conversationId: String? = null) {
        mutableConversationId.value = conversationId
        mutableSnapshot.value = AndroidLiveVoiceSnapshot(
            state = AndroidLiveVoiceState.Error,
            error = message,
        )
    }
}

class AndroidLiveVoiceForegroundService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var session: AndroidLiveVoiceSession? = null
    private var sessionKey: String? = null
    private var wakeLock: PowerManager.WakeLock? = null

    override fun onCreate() {
        super.onCreate()
        NotificationChannels(this).create()
        startForeground(NOTIFICATION_ID, notification(AndroidLiveVoiceState.Connecting))
        wakeLock = getSystemService(PowerManager::class.java)
            ?.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "$packageName:realtime-voice")
            ?.apply { setReferenceCounted(false); acquire() }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            AndroidLiveVoiceForeground.ACTION_START -> {
                val botId = intent.getStringExtra(AndroidLiveVoiceForeground.EXTRA_BOT_ID).orEmpty()
                val channelId = intent.getStringExtra(AndroidLiveVoiceForeground.EXTRA_CHANNEL_ID).orEmpty()
                if (botId.isNotBlank() && channelId.isNotBlank()) startSession(botId, channelId)
            }
            AndroidLiveVoiceForeground.ACTION_STOP -> stopSession()
            AndroidLiveVoiceForeground.ACTION_MICROPHONE ->
                session?.setMicrophoneMuted(intent.getBooleanExtra(AndroidLiveVoiceForeground.EXTRA_MUTED, false))
            AndroidLiveVoiceForeground.ACTION_SPEAKER ->
                session?.setSpeakerMuted(intent.getBooleanExtra(AndroidLiveVoiceForeground.EXTRA_MUTED, false))
        }
        return START_STICKY
    }

    private fun startSession(botId: String, channelId: String) {
        val key = "$botId|$channelId"
        if (session != null && sessionKey == key) return
        session?.stop()
        sessionKey = key
        AndroidLiveVoiceForeground.publishConversationId(channelId)
        AndroidLiveVoiceForeground.publish(AndroidLiveVoiceSnapshot(state = AndroidLiveVoiceState.Connecting))
        scope.launch {
            runCatching {
                val api = HttpMobileGateway(applicationContext)
                check(api.restoreSession() != null) { "Sign in to the server before starting realtime voice." }
                AndroidLiveVoiceSession(
                    api = api,
                    audio = LiveVoiceAudio(applicationContext),
                    scope = scope,
                    onSnapshot = { snapshot ->
                        AndroidLiveVoiceForeground.publish(snapshot)
                        updateNotification(snapshot.state)
                        if (snapshot.state == AndroidLiveVoiceState.Idle) stopSelf()
                    },
                ).also {
                    session = it
                    it.start(botId, channelId)
                }
            }.onFailure { error ->
                val message = error.message ?: "Realtime voice is unavailable."
                val failed = AndroidLiveVoiceSnapshot(
                    state = AndroidLiveVoiceState.Error,
                    error = message,
                )
                AndroidLiveVoiceForeground.publish(failed)
                updateNotification(AndroidLiveVoiceState.Error)
                session = null
                sessionKey = null
                AndroidLiveVoiceForeground.publishConversationId(null)
                stopSelf()
            }
        }
    }

    private fun stopSession() {
        session?.stop()
        session = null
        sessionKey = null
        AndroidLiveVoiceForeground.publishConversationId(null)
        AndroidLiveVoiceForeground.publish(AndroidLiveVoiceSnapshot())
        stopSelf()
    }

    private fun updateNotification(state: AndroidLiveVoiceState) {
        getSystemService(android.app.NotificationManager::class.java)
            ?.notify(NOTIFICATION_ID, notification(state))
    }

    private fun notification(state: AndroidLiveVoiceState): Notification {
        val channelId = sessionKey?.substringAfter('|')?.takeIf(String::isNotBlank)
        val openIntent = channelId?.let {
            AndroidNotificationTapIntent.createForChannel(this, MainActivity::class.java, it)
        }
        val stopIntent = PendingIntent.getService(
            this,
            7401,
            Intent(this, AndroidLiveVoiceForegroundService::class.java)
                .setAction(AndroidLiveVoiceForeground.ACTION_STOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val builder = NotificationCompat.Builder(this, NotificationChannels.VOICE)
            .setSmallIcon(com.aiteamos.android.R.drawable.ic_notification)
            .setContentTitle("Realtime conversation")
            .setContentText(voiceNotificationText(state))
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .addAction(com.aiteamos.android.R.drawable.ic_notification, "End call", stopIntent)
        openIntent?.let(builder::setContentIntent)
        return builder.build()
    }

    override fun onDestroy() {
        session?.stop()
        session = null
        sessionKey = null
        AndroidLiveVoiceForeground.publishConversationId(null)
        wakeLock?.let { if (it.isHeld) it.release() }
        wakeLock = null
        scope.cancel()
        AndroidLiveVoiceForeground.publish(AndroidLiveVoiceSnapshot())
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        private const val NOTIFICATION_ID = 7400

        private fun voiceNotificationText(state: AndroidLiveVoiceState): String = when (state) {
            AndroidLiveVoiceState.Connecting -> "Connecting…"
            AndroidLiveVoiceState.Listening -> "Listening"
            AndroidLiveVoiceState.Processing -> "Thinking"
            AndroidLiveVoiceState.Speaking -> "Speaking"
            AndroidLiveVoiceState.Interrupted -> "Listening"
            AndroidLiveVoiceState.Reconnecting -> "Reconnecting…"
            AndroidLiveVoiceState.Error -> "Connection problem"
            else -> "Realtime voice active"
        }
    }
}
