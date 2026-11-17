package com.outcomego.android.features

import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.getUnclippedBoundsInRoot
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.unit.height
import androidx.compose.ui.unit.width
import com.outcomego.android.data.ChatMessage
import com.outcomego.android.ui.ChatContextSummary
import com.outcomego.android.ui.screens.chat.MessageBubble
import com.outcomego.features.Attachment
import com.outcomego.features.FeatureOperationState
import com.outcomego.features.MarkdownMessage
import com.outcomego.features.RichMessage
import com.outcomego.features.RichMessageBlock
import com.outcomego.features.RichFormField
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class RichMessageRendererTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun formActionExposesValuesToTheSharedActionCallback() {
        val submitted = mutableListOf<Map<String, String>>()
        compose.setContent {
            com.outcomego.features.RichMessageCardScreen(
                message = RichMessage(
                    id = "message-1",
                    blocks = listOf(RichMessageBlock.Form("Profile", listOf(RichFormField("name", "Name")), com.outcomego.features.RichMessageAction("submit", "Submit"))),
                ),
                onAction = { _, values -> submitted += values },
            )
        }

        compose.onNodeWithText("Name").assertExists()
        compose.onNodeWithText("Submit").performClick()

        assertEquals(1, submitted.size)
        assertEquals(null, submitted.single()["name"])
    }

    @Test
    fun widgetActionExposesSelectedValueToTheSharedActionCallback() {
        val submitted = mutableListOf<Map<String, String>>()
        compose.setContent {
            com.outcomego.features.RichMessageCardScreen(
                message = RichMessage(
                    id = "message-2",
                    blocks = listOf(RichMessageBlock.Widget("Choose", listOf(com.outcomego.features.RichWidgetOption("One", "one")))),
                ),
                onAction = { _, values -> submitted += values },
            )
        }

        // A single choice is submitted by tapping it; there is no Submit button.
        compose.onNodeWithText("One").performClick()

        assertEquals(1, submitted.size)
        assertEquals("one", submitted.last()["value"])
    }

    @Test
    fun multiSelectWidgetSubmitsAllSelectedValuesTogether() {
        val submitted = mutableListOf<Map<String, String>>()
        compose.setContent {
            com.outcomego.features.RichMessageCardScreen(
                message = RichMessage(
                    id = "message-3",
                    blocks = listOf(
                        RichMessageBlock.Widget(
                            "Choose",
                            listOf(com.outcomego.features.RichWidgetOption("One", "one"), com.outcomego.features.RichWidgetOption("Two", "two")),
                            multiSelect = true,
                        ),
                    ),
                ),
                onAction = { _, values -> submitted += values },
            )
        }

        compose.onNodeWithText("One").performClick()
        compose.onNodeWithText("Two").performClick()
        compose.onNodeWithText("Submit").performClick()

        assertEquals(1, submitted.size)
        assertEquals("one\ntwo", submitted.last()["value"])
    }

    @Test
    fun threadContextRendererShowsBoundedAnchorContextAndTruncation() {
        compose.setContent {
            ChatContextSummary(
                messages = listOf(ChatMessage("context-1", "Orbit", "Earlier reply")),
                truncated = true,
            )
        }

        compose.onNodeWithTag("thread-context").assertExists()
        compose.onNodeWithTag("thread-context-title").assertExists()
        compose.onNodeWithTag("thread-context-truncated").assertExists()
        compose.onNodeWithText("Earlier reply").assertExists()
    }

    @Test
    fun markdownRendererStylesCommonBlocksWithoutShowingSyntaxMarkers() {
        compose.setContent {
            MarkdownMessage("# Heading\n\n- **First item**\n- `inline code`")
        }

        compose.onNodeWithText("Heading").assertExists()
        compose.onNodeWithText("First item").assertExists()
        compose.onNodeWithText("inline code", substring = true).assertExists()
        compose.onNodeWithText("# Heading", substring = true).assertDoesNotExist()
    }

    @Test
    fun markdownRendererRendersPipeTableAsAlignedCells() {
        compose.setContent {
            MarkdownMessage(
                "| Order | Amount |\n| :--- | ---: |\n| 2610210023 | 316.66 |",
            )
        }

        compose.onNodeWithText("Order").assertExists()
        compose.onNodeWithText("Amount").assertExists()
        compose.onNodeWithText("2610210023").assertExists()
        compose.onNodeWithText("316.66").assertExists()
        compose.onNodeWithText("| Order | Amount |", substring = true).assertDoesNotExist()
    }

    @Test
    fun messageBubbleRendersCompactAttachmentsAboveMessageText() {
        val message = ChatMessage(
            id = "msg-attach-1",
            author = "You",
            body = "Please check the files",
            isMine = true,
            attachments = listOf(
                Attachment(
                    id = "img-1",
                    name = "photo.png",
                    mimeType = "image/png",
                    sizeBytes = 2048,
                    width = 1200,
                    height = 1600,
                ),
                Attachment(
                    id = "doc-1",
                    name = "2025-report.docx",
                    mimeType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                    sizeBytes = 38_912,
                ),
            ),
        )
        compose.setContent {
            MessageBubble(
                message = message,
                onRetry = {},
                isTarget = false,
                operation = FeatureOperationState.Idle,
                onDownload = { _, _ -> },
                onSaveAttachment = { _, _ -> },
                onShareAttachment = {},
                onForwardAttachment = {},
                onAction = { _, _, _ -> },
                onReaction = { _, _ -> },
                onMessageAction = { _, _ -> },
                onContext = {},
                onReply = {},
                onOpenRoutine = {},
                replyOriginal = null,
                onOpenOriginal = {},
            )
        }

        val attachmentsBounds = compose.onNodeWithTag("message-attachments-msg-attach-1", useUnmergedTree = true).getUnclippedBoundsInRoot()
        val bodyBounds = compose.onNodeWithTag("message-body-msg-attach-1", useUnmergedTree = true).getUnclippedBoundsInRoot()
        val imageCardBounds = compose.onNodeWithTag("attachment-card-img-1", useUnmergedTree = true).getUnclippedBoundsInRoot()
        val fileCardBounds = compose.onNodeWithTag("attachment-card-doc-1", useUnmergedTree = true).getUnclippedBoundsInRoot()

        assertTrue(attachmentsBounds.bottom <= bodyBounds.top)
        assertTrue(imageCardBounds.width.value <= 151f)
        assertTrue(imageCardBounds.height.value <= 161f)
        assertTrue(fileCardBounds.width.value <= 181f)
        assertTrue(fileCardBounds.height.value <= 52f)
    }

    @Test
    fun secretRequestCardSubmitsMaskedSecretAndRendersProvidedReceipt() {
        val submitted = mutableListOf<Map<String, String>>()
        compose.setContent {
            com.outcomego.features.RichMessageCardScreen(
                message = RichMessage(
                    id = "secret-1",
                    blocks = listOf(
                        RichMessageBlock.Secret(
                            prompt = "webhook 回调地址",
                            description = "Paste the webhook URL with token",
                            name = "WEBHOOK_URL",
                            scope = "bot",
                        ),
                    ),
                ),
                onAction = { _, values -> submitted += values },
            )
        }

        compose.onNodeWithText("webhook 回调地址").assertExists()
        compose.onNodeWithText("Paste the webhook URL with token").assertExists()
        compose.onNodeWithText("WEBHOOK_URL", substring = true).assertExists()
        compose.onNodeWithTag("secret-request-submit-secret-1").assertIsNotEnabled()

        compose.onNodeWithTag("secret-request-input-secret-1").performTextInput("https://example.test/hook")
        compose.onNodeWithTag("secret-request-submit-secret-1").assertIsEnabled()
        compose.onNodeWithTag("secret-request-submit-secret-1").performClick()

        assertEquals(1, submitted.size)
        assertEquals("https://example.test/hook", submitted.single()["value"])
        assertEquals("secret", submitted.single()["_richType"])
    }

    @Test
    fun secretRequestReceiptHidesInputAndMessageBubbleSuppressesFallbackBody() {
        val message = ChatMessage(
            id = "secret-2",
            author = "研发",
            body = "Secret requested: webhook 回调地址",
            richMessage = RichMessage(
                id = "secret-2",
                blocks = listOf(RichMessageBlock.Secret(prompt = "webhook 回调地址")),
                metadata = mapOf("secretProvided" to "true"),
            ),
        )
        compose.setContent {
            MessageBubble(
                message = message,
                onRetry = {},
                isTarget = false,
                operation = FeatureOperationState.Idle,
                onDownload = { _, _ -> },
                onSaveAttachment = { _, _ -> },
                onShareAttachment = {},
                onForwardAttachment = {},
                onAction = { _, _, _ -> },
                onReaction = { _, _ -> },
                onMessageAction = { _, _ -> },
                onContext = {},
                onReply = {},
                onOpenRoutine = {},
                replyOriginal = null,
                onOpenOriginal = {},
            )
        }

        compose.onNodeWithText("Secret requested: webhook 回调地址").assertDoesNotExist()
        compose.onNodeWithTag("secret-request-receipt-secret-2", useUnmergedTree = true).assertExists()
        compose.onNodeWithTag("secret-saved-badge", useUnmergedTree = true).assertExists()
        compose.onNodeWithTag("secret-request-input-secret-2", useUnmergedTree = true).assertDoesNotExist()
    }
}
