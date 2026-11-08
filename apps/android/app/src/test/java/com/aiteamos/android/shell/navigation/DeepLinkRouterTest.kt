package com.aiteamos.android.shell.navigation

import com.aiteamos.android.navigation.ChatTarget
import com.aiteamos.android.navigation.DeepLinkRouter
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class DeepLinkRouterTest {
    @Test
    fun parsesConversationAndMessageContext() {
        assertEquals(
            ChatTarget("channel-42", "message-9"),
            DeepLinkRouter.parse("aiteamos://chat/channel-42?message=message-9"),
        )
    }

    @Test
    fun rejectsUnknownSchemesAndIncompleteTargets() {
        assertNull(DeepLinkRouter.parse("https://chat/channel-42"))
        assertNull(DeepLinkRouter.parse("aiteamos://chat"))
        assertNull(DeepLinkRouter.parse(null))
    }
}
