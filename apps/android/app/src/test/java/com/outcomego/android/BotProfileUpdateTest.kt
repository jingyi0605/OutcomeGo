package com.outcomego.android

import com.outcomego.android.data.Conversation
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class BotProfileUpdateTest {
    private val customAvatarBot = Conversation(
        id = "channel-1",
        title = "Research",
        subtitle = "Finds sources",
        avatarColor = "#4b8efb",
        botId = "bot-1",
        isBot = true,
        botIcon = "owl",
        botInstructions = "Cite every claim.",
        botVoice = "zh_female_vv_uranus_bigtts",
        botTitle = "Analyst",
        hasAvatar = true,
        avatarPath = "/tmp/cache/bot-1.avatar",
    )

    @Test
    fun updatePayloadOmitsAvatarFieldsWhenUnchangedOrNull() {
        val withNullAvatar = buildUpdateBotPayload(
            conversation = customAvatarBot,
            name = "Research Pro",
            title = "Lead Analyst",
            description = "Deep research",
            instructions = "Always verify.",
            voice = "",
            icon = null,
            color = null,
        )
        assertFalse("icon" in withNullAvatar)
        assertFalse("color" in withNullAvatar)
        assertEquals("Research Pro", withNullAvatar["name"]?.jsonPrimitive?.content)
        assertEquals("Lead Analyst", withNullAvatar["title"]?.jsonPrimitive?.content)

        // Matching icon & case-insensitive hex color must not trigger server avatar clearing.
        val withSameAvatarDifferentCase = buildUpdateBotPayload(
            conversation = customAvatarBot,
            name = "Research",
            title = "Analyst",
            description = "Finds sources",
            instructions = "Cite every claim.",
            voice = "zh_female_vv_uranus_bigtts",
            icon = "owl",
            color = "#4B8EFB",
            resetAvatar = false,
        )
        assertFalse("icon" in withSameAvatarDifferentCase)
        assertFalse("color" in withSameAvatarDifferentCase)
    }

    @Test
    fun updatePayloadIncludesAvatarFieldsWhenChangedOrReset() {
        val colorChanged = buildUpdateBotPayload(
            conversation = customAvatarBot,
            name = "Research",
            title = "Analyst",
            description = "Finds sources",
            instructions = "Cite every claim.",
            voice = "",
            icon = "owl",
            color = "#F23D52",
        )
        assertEquals("owl", colorChanged["icon"]?.jsonPrimitive?.content)
        assertEquals("#F23D52", colorChanged["color"]?.jsonPrimitive?.content)

        val resetRequested = buildUpdateBotPayload(
            conversation = customAvatarBot,
            name = "Research",
            title = "Analyst",
            description = "Finds sources",
            instructions = "Cite every claim.",
            voice = "",
            icon = "owl",
            color = "#4b8efb",
            resetAvatar = true,
        )
        assertEquals("owl", resetRequested["icon"]?.jsonPrimitive?.content)
        assertEquals("#4b8efb", resetRequested["color"]?.jsonPrimitive?.content)
    }

    @Test
    fun applyBotUpdatePreservesOrClearsCustomAvatarBasedOnServerResponse() {
        val preservePayload = buildUpdateBotPayload(
            conversation = customAvatarBot,
            name = "Research Updated",
            title = "Principal",
            description = "New desc",
            instructions = "New instructions",
            voice = "en_male_tim_uranus_bigtts",
            icon = null,
            color = null,
        )
        val preservedResponse = Json.parseToJsonElement(
            """
            {
              "id": "bot-1",
              "name": "Research Updated",
              "title": "Principal",
              "description": "New desc",
              "instructions": "New instructions",
              "voice": "en_male_tim_uranus_bigtts",
              "icon": "owl",
              "color": "#4b8efb",
              "hasAvatar": true
            }
            """.trimIndent(),
        ).jsonObject

        val preserved = customAvatarBot.applyBotUpdate(preservedResponse, preservePayload)
        assertEquals("Research Updated", preserved.title)
        assertEquals("Principal", preserved.botTitle)
        assertEquals("New desc", preserved.subtitle)
        assertEquals("New instructions", preserved.botInstructions)
        assertEquals("en_male_tim_uranus_bigtts", preserved.botVoice)
        assertTrue(preserved.hasAvatar)
        assertTrue(preserved.hasCustomAvatar)
        assertEquals("/tmp/cache/bot-1.avatar", preserved.avatarPath)

        val replacePayload = buildUpdateBotPayload(
            conversation = customAvatarBot,
            name = "Research",
            title = "Analyst",
            description = "Finds sources",
            instructions = "Cite every claim.",
            voice = "",
            icon = "chip",
            color = "#A47952",
            resetAvatar = true,
        )
        val replacedResponse = Json.parseToJsonElement(
            """
            {
              "id": "bot-1",
              "name": "Research",
              "title": "Analyst",
              "description": "Finds sources",
              "instructions": "Cite every claim.",
              "voice": "",
              "icon": "chip",
              "color": "#A47952",
              "hasAvatar": false
            }
            """.trimIndent(),
        ).jsonObject

        val replaced = customAvatarBot.applyBotUpdate(replacedResponse, replacePayload)
        assertEquals("chip", replaced.botIcon)
        assertEquals("#A47952", replaced.avatarColor)
        assertFalse(replaced.hasAvatar)
        assertFalse(replaced.hasCustomAvatar)
        assertNull(replaced.avatarPath)
    }
}
