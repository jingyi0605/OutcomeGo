package com.aiteamos.platform

interface LiveVoiceWebSocket {
    fun connect(url: String, protocols: List<String>, onText: (String) -> Unit, onBinary: (ByteArray) -> Unit, onClosed: (String?) -> Unit)
    fun sendText(value: String)
    fun sendBinary(value: ByteArray)
    fun close()
}
