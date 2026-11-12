package com.outcomego.android.shell.navigation

import com.outcomego.android.navigation.ChatTarget
import com.outcomego.android.navigation.DeepLinkRouter
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class DeepLinkRouterTest {
    @Test
    fun parsesConversationAndMessageContext() {
        assertEquals(
            ChatTarget("channel-42", "message-9"),
            DeepLinkRouter.parse("outcomego://chat/channel-42?message=message-9"),
        )
    }

    @Test
    fun rejectsUnknownSchemesAndIncompleteTargets() {
        assertNull(DeepLinkRouter.parse("https://chat/channel-42"))
        assertNull(DeepLinkRouter.parse("outcomego://chat"))
        assertNull(DeepLinkRouter.parse(null))
    }
}
