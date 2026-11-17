package com.outcomego.features

import android.graphics.BitmapFactory
import android.net.Uri
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.Movie
import androidx.compose.material.icons.filled.MusicNote
import androidx.compose.material.icons.filled.TextFields
import androidx.compose.material.icons.outlined.Shield
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.outcomego.android.ui.designsystem.GlassTier
import com.outcomego.android.ui.designsystem.SpatialGlassSurface
import com.outcomego.android.ui.designsystem.SpatialGlassTextField
import com.outcomego.android.ui.designsystem.SpatialHairlineDivider
import com.outcomego.android.ui.designsystem.SpatialPrimaryButton
import com.outcomego.android.ui.designsystem.SpatialRadii
import com.outcomego.android.ui.designsystem.SpatialSecondaryButton
import com.outcomego.android.ui.designsystem.SpatialSpacing
import com.outcomego.android.ui.designsystem.SpatialTheme
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.FileInputStream
import java.util.Locale

@Composable
private fun MessageAction.localizedLabel(): String = when (this) {
    MessageAction.Fork -> localizedText("Fork", "分支")
    MessageAction.Stop -> localizedText("Stop", "停止")
    MessageAction.Dismiss -> localizedText("Dismiss", "忽略")
    MessageAction.Approve -> localizedText("Approve", "批准")
}

@Composable
fun RichMessageCardScreen(
    message: RichMessage,
    operation: FeatureOperationState = FeatureOperationState.Idle,
    onAction: (RichMessageAction, Map<String, String>) -> Unit,
) {
    val values = remember(message.id) { mutableStateMapOf<String, String>() }
    // A standalone question or secret-request card is the whole message, so it renders directly in the bubble.
    val cardOnly = message.isQuestion || message.isSecretRequest
    val content: @Composable () -> Unit = {
        Column(
            Modifier.padding(if (cardOnly) 0.dp else 16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            message.blocks.forEach { block ->
                when (block) {
                    is RichMessageBlock.Markdown -> MarkdownMessage(block.text)
                    is RichMessageBlock.Code -> CodeBlock(block.language, block.code)
                    is RichMessageBlock.Math -> CodeBlock("math", block.expression)
                    is RichMessageBlock.Mermaid -> CodeBlock("mermaid", block.source)
                    is RichMessageBlock.Table -> MessageTable(block)
                    is RichMessageBlock.Card -> {
                        Text(block.title, fontWeight = FontWeight.Bold, color = SpatialTheme.colors.textPrimary)
                        Text(block.body, color = SpatialTheme.colors.textSecondary)
                        block.action?.let { ActionButton(it) { onAction(it, emptyMap()) } }
                    }
                    is RichMessageBlock.Form -> {
                        Text(block.title, fontWeight = FontWeight.Bold, color = SpatialTheme.colors.textPrimary)
                        block.fields.forEach { field ->
                            val fieldLabel = field.label + if (field.required) " *" else ""
                            val currentValue = values[field.id] ?: field.value
                            if (field.options.isNotEmpty()) {
                                val selectPlaceholder = localizedText("Select…", "请选择…")
                                val options = (field.options + currentValue).filter { it.isNotBlank() }.distinct()
                                DropdownSelectorField(
                                    selectedValue = currentValue,
                                    options = options,
                                    optionLabel = { it.ifBlank { selectPlaceholder } },
                                    onSelect = { values[field.id] = it },
                                    label = fieldLabel,
                                    placeholder = selectPlaceholder,
                                    modifier = Modifier.fillMaxWidth(),
                                )
                            } else {
                                SpatialGlassTextField(
                                    value = currentValue,
                                    onValueChange = { values[field.id] = it },
                                    label = fieldLabel,
                                    visualTransformation = if (field.secret) PasswordVisualTransformation() else VisualTransformation.None,
                                    modifier = Modifier.fillMaxWidth(),
                                    singleLine = true,
                                )
                            }
                        }
                        ActionButton(block.submit) { onAction(block.submit, values.toMap() + ("_richType" to "user-form")) }
                    }
                    is RichMessageBlock.Secret -> SecretRequestCard(message, block, operation, onAction)
                    is RichMessageBlock.Approval -> {
                        Text(block.title, fontWeight = FontWeight.Bold, color = SpatialTheme.colors.textPrimary)
                        Text(block.detail, color = SpatialTheme.colors.textSecondary)
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            ActionButton(block.approve) { onAction(block.approve, emptyMap()) }
                            ActionButton(block.reject) { onAction(block.reject, emptyMap()) }
                        }
                    }
                    is RichMessageBlock.Widget -> WidgetQuestion(message, block, operation, onAction)
                }
            }
            message.actions.forEach { action -> ActionButton(action) { onAction(action, emptyMap()) } }
            OperationStatus(operation)
        }
    }
    if (cardOnly) {
        Box(Modifier.fillMaxWidth()) { content() }
    } else {
        SpatialGlassSurface(
            modifier = Modifier.fillMaxWidth().padding(12.dp),
            shape = RoundedCornerShape(SpatialRadii.lg),
            tier = GlassTier.Card,
        ) { content() }
    }
}

private fun secretRequestPlaceholder(label: String): String {
    val hasDeterminer = Regex("^(?:a|an|the|your|my)\\s", RegexOption.IGNORE_CASE).containsMatchIn(label)
    return "Paste ${if (hasDeterminer) label else "your $label"}"
}

/**
 * Masked credential prompt matching Desktop's SecretCard: collapses into a "Saved" receipt once
 * `secretProvided` is set, and never exposes the entered value back into the transcript.
 */
@Composable
private fun SecretRequestCard(
    message: RichMessage,
    block: RichMessageBlock.Secret,
    operation: FeatureOperationState,
    onAction: (RichMessageAction, Map<String, String>) -> Unit,
) {
    val colors = SpatialTheme.colors
    val haptics = LocalAppHaptics.current
    val provided = message.metadata["secretProvided"] == "true"
    val botSecret = !block.name.isNullOrBlank() && block.scope != "personal"
    val variableNote = block.name?.takeIf { it.isNotBlank() }?.let { envName ->
        if (botSecret) {
            localizedText(
                "Saved securely for all users of this bot and exposed as $envName",
                "已为此机器人的所有用户安全保存，并以 $envName 公开",
            )
        } else {
            localizedText(
                "Saved securely for you and exposed as $envName",
                "已为你安全保存，并以 $envName 公开",
            )
        }
    }

    if (provided) {
        Row(
            modifier = Modifier.fillMaxWidth().testTag("secret-request-receipt-${message.id}"),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                Text(block.prompt, fontWeight = FontWeight.Medium, color = colors.textPrimary)
                variableNote?.let {
                    Text(it, style = MaterialTheme.typography.bodySmall, color = colors.textSecondary)
                }
                Text(
                    if (botSecret) {
                        localizedText(
                            "Saved for all users of this bot. Configure in bot settings.",
                            "已为此机器人的所有用户保存。可在机器人设置中配置。",
                        )
                    } else {
                        localizedText(
                            "Saved securely and kept private.",
                            "已安全保存并保持私密。",
                        )
                    },
                    style = MaterialTheme.typography.bodySmall,
                    color = colors.textSecondary,
                )
            }
            Row(
                modifier = Modifier
                    .clip(CircleShape)
                    .background(colors.success.copy(alpha = if (colors.isDark) 0.18f else 0.12f))
                    .padding(horizontal = 12.dp, vertical = 6.dp)
                    .testTag("secret-saved-badge"),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Icon(
                    Icons.Default.Check,
                    contentDescription = null,
                    modifier = Modifier.size(14.dp),
                    tint = colors.success,
                )
                Text(
                    localizedText("Saved", "已保存"),
                    style = MaterialTheme.typography.labelMedium,
                    fontWeight = FontWeight.Medium,
                    color = colors.success,
                )
            }
        }
        return
    }

    var value by remember(message.id, block.prompt) { mutableStateOf("") }
    val busy = operation is FeatureOperationState.Pending
    fun submit() {
        val secret = value
        if (secret.isBlank() || busy || !block.submit.enabled) return
        haptics.play(HapticEffect.Light)
        value = ""
        onAction(block.submit, mapOf("value" to secret, "_richType" to "secret"))
    }

    Column(
        modifier = Modifier.fillMaxWidth().testTag("secret-request-pending-${message.id}"),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(block.prompt, fontWeight = FontWeight.Medium, color = colors.textPrimary)
            variableNote?.let {
                Text(it, style = MaterialTheme.typography.bodySmall, color = colors.textSecondary)
            }
            block.description?.takeIf { it.isNotBlank() }?.let {
                Text(it, style = MaterialTheme.typography.bodySmall, color = colors.textSecondary)
            }
        }
        SpatialGlassTextField(
            value = value,
            onValueChange = { value = it },
            placeholder = localizedText(secretRequestPlaceholder(block.prompt), "粘贴 ${block.prompt}"),
            enabled = !busy,
            visualTransformation = PasswordVisualTransformation(),
            singleLine = true,
            keyboardOptions = KeyboardOptions(
                autoCorrectEnabled = false,
                keyboardType = KeyboardType.Password,
                imeAction = ImeAction.Done,
            ),
            keyboardActions = KeyboardActions(onDone = { submit() }),
            modifier = Modifier.fillMaxWidth().testTag("secret-request-input-${message.id}"),
        )
        val submitLabel = if (block.submit.label == "Save securely" || block.submit.label == "Submit") {
            localizedText("Save securely", "安全保存")
        } else {
            block.submit.label
        }
        SpatialPrimaryButton(
            label = submitLabel,
            onClick = ::submit,
            enabled = value.isNotBlank() && !busy && block.submit.enabled,
            testTag = "secret-request-submit-${message.id}",
        )
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Icon(
                Icons.Outlined.Shield,
                contentDescription = null,
                modifier = Modifier.size(14.dp),
                tint = colors.textSecondary,
            )
            Text(
                if (botSecret) {
                    localizedText(
                        "Saved for all users of this bot. Never shown to other bots.",
                        "已为此机器人的所有用户保存，不会向其他机器人显示。",
                    )
                } else {
                    localizedText(
                        "Stored securely, never shown to your Bot.",
                        "已安全存储，不会向你的机器人显示。",
                    )
                },
                style = MaterialTheme.typography.bodySmall,
                color = colors.textSecondary,
            )
        }
    }
}

/**
 * Question card shared with the iOS client: a prompt, a dismiss control, and a bordered option list.
 * A single choice is submitted by tapping it. Only multi-select needs a Submit button.
 */
@Composable
private fun WidgetQuestion(
    message: RichMessage,
    block: RichMessageBlock.Widget,
    operation: FeatureOperationState,
    onAction: (RichMessageAction, Map<String, String>) -> Unit,
) {
    val haptics = LocalAppHaptics.current
    val responded = message.metadata["respondedValue"]
    val dismissed = message.metadata["widgetDismissed"] == "true"
    val busy = operation is FeatureOperationState.Pending
    var selected by remember(message.id, block.prompt) { mutableStateOf(emptySet<String>()) }
    val outline = SpatialTheme.colors.glassBorderStart
    val muted = SpatialTheme.colors.textSecondary

    fun respond(value: String) = onAction(
        RichMessageAction("widget-response", value, route = "widget-response"),
        mapOf("value" to value, "_richType" to "widget-response"),
    )

    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(verticalAlignment = Alignment.Top) {
            Text(block.prompt, Modifier.weight(1f), fontWeight = FontWeight.Medium, color = SpatialTheme.colors.textPrimary)
            if (responded == null && !dismissed) {
                IconButton(
                    onClick = {
                        haptics.play(HapticEffect.Light)
                        onAction(
                            RichMessageAction("widget-dismiss", "Dismiss", route = "widget-dismiss"),
                            mapOf("_richType" to "widget-dismiss"),
                        )
                    },
                    enabled = !busy,
                    modifier = Modifier.size(28.dp),
                ) {
                    Icon(
                        Icons.Default.Close,
                        contentDescription = localizedText("Dismiss", "忽略"),
                        modifier = Modifier.size(16.dp),
                        tint = muted,
                    )
                }
            }
        }
        block.helpText?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = muted) }
        val frameShape = RoundedCornerShape(14.dp)
        val frame = Modifier
            .fillMaxWidth()
            .clip(frameShape)
            .background(SpatialTheme.colors.glassSubtle)
            .border(0.75.dp, outline, frameShape)
        if (responded != null) {
            val answers = responded.split("\n").filter { it.isNotBlank() }
                .map { value -> block.options.firstOrNull { it.value == value }?.label ?: value }
            Column(frame) {
                answers.forEachIndexed { index, answer ->
                    if (index > 0) HorizontalDivider(color = outline, thickness = 0.5.dp)
                    Row(
                        Modifier.fillMaxWidth().heightIn(min = 42.dp).padding(horizontal = 12.dp, vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(answer, Modifier.weight(1f), color = SpatialTheme.colors.textPrimary)
                        Icon(
                            Icons.Default.Check,
                            contentDescription = localizedText("Selected", "已选择"),
                            modifier = Modifier.size(16.dp),
                            tint = MaterialTheme.colorScheme.primary,
                        )
                    }
                }
            }
        } else {
            Column(frame.then(if (dismissed) Modifier.alpha(0.35f) else Modifier)) {
                block.options.forEachIndexed { index, option ->
                    if (index > 0) HorizontalDivider(color = outline.copy(alpha = 0.6f), thickness = 0.5.dp)
                    val isSelected = option.value in selected
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .heightIn(min = 42.dp)
                            .background(if (isSelected) MaterialTheme.colorScheme.primary.copy(alpha = 0.12f) else Color.Transparent)
                            .clickable(enabled = !dismissed && !busy) {
                                haptics.play(HapticEffect.Selection)
                                if (block.multiSelect) {
                                    selected = if (isSelected) selected - option.value else selected + option.value
                                } else {
                                    respond(option.value)
                                }
                            }
                            .padding(horizontal = 12.dp, vertical = 10.dp),
                        verticalAlignment = Alignment.Top,
                    ) {
                        Box(
                            Modifier
                                .size(22.dp)
                                .clip(RoundedCornerShape(6.dp))
                                .background(if (isSelected) MaterialTheme.colorScheme.primary else SpatialTheme.colors.glassFloating),
                            contentAlignment = Alignment.Center,
                        ) {
                            Text(
                                if (index < 26) ('A' + index).toString() else (index + 1).toString(),
                                style = MaterialTheme.typography.labelSmall,
                                color = if (isSelected) MaterialTheme.colorScheme.onPrimary else muted,
                                fontWeight = FontWeight.SemiBold,
                            )
                        }
                        Spacer(Modifier.width(10.dp))
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                            Text(
                                option.label,
                                color = if (option.style == "danger") SpatialTheme.colors.danger else SpatialTheme.colors.textPrimary,
                                fontWeight = if (isSelected) FontWeight.Medium else FontWeight.Normal,
                            )
                            option.description?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = muted) }
                        }
                        if (isSelected) {
                            Icon(
                                Icons.Default.Check,
                                contentDescription = localizedText("Selected", "已选择"),
                                modifier = Modifier.size(16.dp),
                                tint = MaterialTheme.colorScheme.primary,
                            )
                        }
                    }
                }
            }
            if (dismissed) {
                Text(localizedText("dismissed", "已忽略"), style = MaterialTheme.typography.labelSmall, color = muted)
            } else {
                if (block.allowCustom) {
                    Text(localizedText("Or answer in the chat below", "也可以在下方输入框中回答"), style = MaterialTheme.typography.bodySmall, color = muted)
                }
                if (block.multiSelect) {
                    SpatialPrimaryButton(
                        label = localizedText("Submit", "提交"),
                        onClick = {
                            respond(block.options.map { it.value }.filter { it in selected }.joinToString("\n"))
                        },
                        enabled = selected.isNotEmpty() && !busy,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }
        }
    }
}

@Composable
private fun CodeBlock(language: String?, code: String) {
    val shape = RoundedCornerShape(14.dp)
    Column(
        Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(SpatialTheme.colors.glassSubtle)
            .border(0.75.dp, SpatialTheme.colors.glassBorderStart, shape)
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        language?.takeIf { it.isNotBlank() }?.let {
            Text(it, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary, fontFamily = FontFamily.Monospace)
        }
        Text(code, fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.bodySmall, color = SpatialTheme.colors.textPrimary)
    }
}

@Composable
private fun MessageTable(table: RichMessageBlock.Table) {
    val shape = RoundedCornerShape(12.dp)
    Column(
        Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(SpatialTheme.colors.glassSubtle)
            .border(0.75.dp, SpatialTheme.colors.glassBorderStart, shape)
            .horizontalScroll(rememberScrollState()),
    ) {
        Row(Modifier.background(SpatialTheme.colors.glassFloating), horizontalArrangement = Arrangement.spacedBy(20.dp)) {
            table.headers.forEach { Text(it, Modifier.padding(10.dp), fontWeight = FontWeight.Bold, color = SpatialTheme.colors.textPrimary) }
        }
        SpatialHairlineDivider(insetStart = 0.dp)
        table.rows.forEachIndexed { index, row ->
            if (index > 0) SpatialHairlineDivider(insetStart = 0.dp)
            Row(horizontalArrangement = Arrangement.spacedBy(20.dp)) {
                row.forEach { Text(it, Modifier.padding(10.dp), color = SpatialTheme.colors.textPrimary) }
            }
        }
    }
}

@Composable
private fun ActionButton(action: RichMessageAction, onClick: () -> Unit) {
    val haptics = LocalAppHaptics.current
    val triggered = {
        haptics.play(HapticEffect.Light)
        onClick()
    }
    when (action.kind) {
        RichMessageAction.Kind.Primary -> SpatialPrimaryButton(
            label = action.label,
            onClick = triggered,
            enabled = action.enabled,
        )
        RichMessageAction.Kind.Secondary -> SpatialSecondaryButton(
            label = action.label,
            onClick = triggered,
            enabled = action.enabled,
        )
        RichMessageAction.Kind.Destructive -> Button(
            onClick = triggered,
            enabled = action.enabled,
            shape = CircleShape,
            colors = ButtonDefaults.buttonColors(
                containerColor = SpatialTheme.colors.danger,
                contentColor = Color.White,
            ),
            modifier = Modifier.fillMaxWidth().heightIn(min = 50.dp),
        ) {
            Text(action.label, fontWeight = FontWeight.SemiBold)
        }
    }
}

@Composable
fun AttachmentGalleryScreen(
    state: FeatureLoadState<List<Attachment>>,
    operation: FeatureOperationState = FeatureOperationState.Idle,
    onRetry: () -> Unit,
    onAttachmentAction: (Attachment, AttachmentAction) -> Unit,
    onUpload: () -> Unit = {},
    onBack: (() -> Unit)? = null,
) {
    FeaturePage(localizedText("Attachments", "附件"), onBack = onBack) {
        LoadStateContent(state, onRetry) { attachments ->
            LazyColumn(
                Modifier.fillMaxSize().padding(horizontal = SpatialSpacing.md),
                verticalArrangement = Arrangement.spacedBy(12.dp),
                contentPadding = PaddingValues(vertical = 12.dp),
            ) {
                item {
                    SpatialPrimaryButton(
                        label = localizedText("Add attachment", "添加附件"),
                        onClick = onUpload,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                items(attachments, key = { it.id }) { attachment ->
                    SpatialGlassSurface(
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(SpatialRadii.lg),
                        tier = GlassTier.Card,
                    ) {
                        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(attachment.name, Modifier.weight(1f), fontWeight = FontWeight.SemiBold, color = SpatialTheme.colors.textPrimary)
                                Text(formatBytes(attachment.sizeBytes), style = MaterialTheme.typography.labelSmall, color = SpatialTheme.colors.textSecondary)
                            }
                            Text(attachment.mimeType, style = MaterialTheme.typography.bodySmall, color = SpatialTheme.colors.textSecondary)
                            Text(attachment.state.label(), style = MaterialTheme.typography.labelMedium, color = SpatialTheme.colors.textTertiary)
                            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                if (attachment.state == AttachmentState.Available) {
                                    TextButton(onClick = { onAttachmentAction(attachment, AttachmentAction.Preview) }) { Text(localizedText("Preview", "预览")) }
                                    TextButton(onClick = { onAttachmentAction(attachment, AttachmentAction.Download) }) { Text(localizedText("Download", "下载")) }
                                    TextButton(onClick = { onAttachmentAction(attachment, AttachmentAction.Save) }) { Text(localizedText("Save", "保存")) }
                                    TextButton(onClick = { onAttachmentAction(attachment, AttachmentAction.Share) }) { Text(localizedText("Share", "分享")) }
                                    TextButton(onClick = { onAttachmentAction(attachment, AttachmentAction.Forward) }) { Text(localizedText("Forward", "转发")) }
                                }
                                if (attachment.state == AttachmentState.Failed) {
                                    TextButton(onClick = { onAttachmentAction(attachment, AttachmentAction.Retry) }) { Text(localizedText("Retry", "重试")) }
                                }
                            }
                        }
                    }
                }
                item { OperationStatus(operation) }
            }
        }
    }
}

/**
 * Decodes a local image off the main thread, downsampled to roughly [maxSizePx] on its longest
 * edge. Full-size synchronous decodes during composition dropped frames while scrolling chats.
 */
@Composable
fun rememberDecodedBitmap(path: String?, maxSizePx: Int): ImageBitmap? {
    val context = LocalContext.current
    val bitmap by produceState<ImageBitmap?>(null, path, maxSizePx) {
        value = path?.let { file ->
            withContext(Dispatchers.IO) {
                runCatching {
                    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                    openBitmapStream(context, file).use { BitmapFactory.decodeStream(it, null, bounds) }
                    var sample = 1
                    while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= maxSizePx) sample *= 2
                    openBitmapStream(context, file).use {
                        BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample })
                    }?.asImageBitmap()
                }.getOrNull()
            }
        }
    }
    return bitmap
}

internal fun openBitmapStream(context: android.content.Context, path: String) =
    Uri.parse(path).let { uri ->
        if (uri.scheme == "content") {
            context.contentResolver.openInputStream(uri)
                ?: error("The image could not be opened.")
        } else {
            FileInputStream(if (uri.scheme == "file") uri.path ?: path else path)
        }
    }

@Composable
fun ChatAttachmentStrip(
    attachments: List<Attachment>,
    onPreview: (Attachment, AttachmentAction) -> Unit,
    onDownload: (Attachment, AttachmentAction) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        attachments.forEach { attachment ->
            val localPath = attachment.localUri
            if (attachment.isImage) {
                LaunchedEffect(attachment.id, localPath) {
                    if (localPath == null) onDownload(attachment, AttachmentAction.Download)
                }
                val bitmap = rememberDecodedBitmap(localPath, maxSizePx = 1024)
                val maxImageWidth = 150.dp
                val maxImageHeight = 160.dp
                val sourceWidth = bitmap?.width ?: attachment.width
                val sourceHeight = bitmap?.height ?: attachment.height
                val (boxWidth, boxHeight) = if (sourceWidth != null && sourceHeight != null && sourceWidth > 0 && sourceHeight > 0) {
                    val aspect = sourceWidth.toFloat() / sourceHeight.toFloat()
                    if (aspect >= 1f) {
                        maxImageWidth to (maxImageWidth / aspect).coerceIn(48.dp, maxImageHeight)
                    } else {
                        (maxImageHeight * aspect).coerceIn(56.dp, maxImageWidth) to maxImageHeight
                    }
                } else {
                    140.dp to 60.dp
                }
                SpatialGlassSurface(
                    modifier = Modifier.testTag("attachment-card-${attachment.id}"),
                    shape = RoundedCornerShape(12.dp),
                    tier = GlassTier.Card,
                    shadowElevation = 0.dp,
                    onClick = { onPreview(attachment, AttachmentAction.Preview) },
                ) {
                    if (bitmap != null) {
                        Image(
                            bitmap,
                            contentDescription = attachment.alt ?: attachment.name,
                            modifier = Modifier.size(width = boxWidth, height = boxHeight),
                            contentScale = ContentScale.Crop,
                        )
                    } else {
                        Box(Modifier.size(width = boxWidth, height = boxHeight), contentAlignment = Alignment.Center) {
                            CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 1.75.dp)
                        }
                    }
                }
            } else {
                // As on macOS and iOS, the whole card opens the viewer; downloading starts from there.
                FileAttachmentCard(
                    attachment = attachment,
                    modifier = Modifier.testTag("attachment-card-${attachment.id}"),
                ) {
                    onPreview(attachment, AttachmentAction.Preview)
                }
            }
        }
    }
}

/** A file's compact size as the other clients show it: "658B", "38kB", "1.2MB". */
fun formatAttachmentSize(bytes: Long): String {
    if (bytes < 0) return ""
    val units = arrayOf("B", "kB", "MB", "GB")
    var value = bytes.toDouble()
    var unit = 0
    while (value >= 1024 && unit < units.lastIndex) {
        value /= 1024
        unit += 1
    }
    val text = if (unit == 0 || value >= 10) "%.0f".format(Locale.ROOT, value) else "%.1f".format(Locale.ROOT, value)
    return text + units[unit]
}

private enum class FileGlyphVariant { Pdf, Docx, Ppt, Spreadsheet, Generic, Zip, Image, Video, Audio, Font, Unknown }

private val glyphExtensions: Map<String, FileGlyphVariant> = buildMap {
    listOf("doc", "docx", "odt", "pages", "rtf").forEach { put(it, FileGlyphVariant.Docx) }
    listOf("ppt", "pptx", "odp", "key").forEach { put(it, FileGlyphVariant.Ppt) }
    listOf("xls", "xlsx", "csv", "tsv", "ods", "numbers").forEach { put(it, FileGlyphVariant.Spreadsheet) }
    listOf("zip", "gz", "tgz", "tar", "7z", "rar").forEach { put(it, FileGlyphVariant.Zip) }
    listOf("md", "markdown", "txt", "log", "html", "xml", "yaml", "yml", "json", "js", "ts", "py", "swift", "kt").forEach { put(it, FileGlyphVariant.Generic) }
    listOf("png", "jpg", "jpeg", "gif", "webp", "heic", "svg").forEach { put(it, FileGlyphVariant.Image) }
    listOf("mp4", "mov", "m4v", "webm", "mkv").forEach { put(it, FileGlyphVariant.Video) }
    listOf("mp3", "m4a", "wav", "aac", "ogg", "flac").forEach { put(it, FileGlyphVariant.Audio) }
    listOf("otf", "ttf", "woff", "woff2").forEach { put(it, FileGlyphVariant.Font) }
    put("pdf", FileGlyphVariant.Pdf)
}

private fun glyphVariant(fileName: String): FileGlyphVariant {
    val dot = fileName.lastIndexOf('.')
    return glyphExtensions[if (dot > 0) fileName.substring(dot + 1).lowercase() else ""] ?: FileGlyphVariant.Unknown
}

@Composable
private fun FileAttachmentCard(
    attachment: Attachment,
    modifier: Modifier = Modifier,
    onOpen: () -> Unit,
) {
    val shape = RoundedCornerShape(12.dp)
    SpatialGlassSurface(
        modifier = modifier.widthIn(min = 120.dp, max = 180.dp),
        shape = shape,
        tier = GlassTier.Card,
        shadowElevation = 0.dp,
        onClick = onOpen,
    ) {
        Row(
            Modifier.padding(horizontal = 9.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            FileGlyph(attachment.name, scale = 0.55f)
            Column(Modifier.weight(1f, fill = false)) {
                Text(
                    attachment.name,
                    style = MaterialTheme.typography.labelMedium,
                    fontWeight = FontWeight.Medium,
                    color = SpatialTheme.colors.textPrimary,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    formatAttachmentSize(attachment.sizeBytes),
                    style = MaterialTheme.typography.labelSmall,
                    color = SpatialTheme.colors.textSecondary,
                    maxLines = 1,
                )
            }
            if (attachment.state == AttachmentState.Downloading) {
                CircularProgressIndicator(Modifier.size(14.dp), strokeWidth = 1.75.dp)
            }
        }
    }
}

/** A 32x40 paper icon (scaled by [scale]): lines of ink and a colored band by file type, as on macOS. */
@Composable
fun FileGlyph(fileName: String, modifier: Modifier = Modifier, scale: Float = 1f) {
    val variant = glyphVariant(fileName)
    val dark = SpatialTheme.colors.isDark
    val ink = if (dark) Color(0x3DF5F5F5) else Color(0x2E1C1C1C)
    val mark = if (dark) Color(0x80F5F5F5) else Color(0x851C1C1C)
    val stripe = when (variant) {
        FileGlyphVariant.Pdf -> if (dark) Color(0xFFFC2C3E) else Color(0xFFFB2B3E)
        FileGlyphVariant.Docx -> if (dark) Color(0xFF116DD2) else Color(0xFF1680F3)
        FileGlyphVariant.Ppt -> if (dark) Color(0xFFCD5309) else Color(0xFFEE620D)
        FileGlyphVariant.Spreadsheet -> if (dark) Color(0xFF0E9F5A) else Color(0xFF10AB61)
        else -> null
    }
    val paper = RoundedCornerShape((6f * scale).dp)
    fun Modifier.line(width: Int) =
        this.width((width * scale).dp)
            .height((4f * scale).dp)
            .clip(RoundedCornerShape((2f * scale).dp))
            .background(ink)
    Column(
        modifier
            .size(width = (32f * scale).dp, height = (40f * scale).dp)
            .clip(paper)
            .background(if (dark) Color(0xFF2C2C2C) else Color.White)
            .border((0.5f * scale).coerceAtLeast(0.4f).dp, ink, paper),
    ) {
        val symbol = when (variant) {
            FileGlyphVariant.Image -> Icons.Default.Image
            FileGlyphVariant.Video -> Icons.Default.Movie
            FileGlyphVariant.Audio -> Icons.Default.MusicNote
            FileGlyphVariant.Font -> Icons.Default.TextFields
            else -> null
        }
        when {
            symbol != null -> Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
                Icon(symbol, contentDescription = null, tint = mark, modifier = Modifier.size((16f * scale).dp))
            }
            variant == FileGlyphVariant.Unknown -> Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
                Text("?", fontSize = (17f * scale).sp, color = mark)
            }
            variant == FileGlyphVariant.Zip -> Column(
                Modifier.weight(1f).fillMaxWidth().padding(top = (4f * scale).dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy((3f * scale).dp),
            ) {
                repeat(5) { row ->
                    Box(
                        Modifier
                            .offset(x = ((if (row % 2 == 0) -2.5f else 2.5f) * scale).dp)
                            .size(width = (5f * scale).dp, height = (3f * scale).dp)
                            .background(ink),
                    )
                }
            }
            else -> Column(
                Modifier.weight(1f).fillMaxWidth().padding((4f * scale).dp),
                verticalArrangement = Arrangement.spacedBy((3f * scale).dp),
            ) {
                Box(Modifier.line(24))
                if (stripe != null) {
                    Row(Modifier.height((11f * scale).dp), horizontalArrangement = Arrangement.spacedBy((2f * scale).dp)) {
                        Column(verticalArrangement = Arrangement.spacedBy((3f * scale).dp)) {
                            Box(Modifier.line(11))
                            Box(Modifier.line(11))
                        }
                        Box(
                            Modifier
                                .size((11f * scale).dp)
                                .clip(RoundedCornerShape((2f * scale).dp))
                                .background(ink),
                        )
                    }
                } else {
                    Box(Modifier.line(20))
                    Box(Modifier.line(24))
                    Box(Modifier.line(16))
                }
            }
        }
        if (stripe != null) Box(Modifier.fillMaxWidth().height((12f * scale).dp).background(stripe))
    }
}

enum class AttachmentAction { Preview, Download, Share, Save, Forward, Retry }

@Composable
private fun AttachmentState.label() = when (this) {
    AttachmentState.Queued -> localizedText("Queued", "排队中")
    AttachmentState.Uploading -> localizedText("Uploading…", "正在上传…")
    AttachmentState.Available -> localizedText("Ready", "就绪")
    AttachmentState.Downloading -> localizedText("Downloading…", "正在下载…")
    AttachmentState.Failed -> localizedText("Transfer failed", "传输失败")
}

private fun formatBytes(value: Long): String = when {
    value < 1_024 -> "$value B"
    value < 1_024 * 1_024 -> "${value / 1_024} KB"
    else -> "${value / (1_024 * 1_024)} MB"
}

@Composable
fun ReactionsAndActionsRow(
    state: ReactionState,
    availableEmojis: List<String> = listOf("👍", "❤️", "🎉", "👀"),
    onReaction: (String) -> Unit,
    onAction: (MessageAction) -> Unit,
) {
    val haptics = LocalAppHaptics.current
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            state.reactions.forEach { reaction ->
                ReactionGlassChip("${reaction.emoji} ${reaction.count}") {
                    haptics.play(HapticEffect.Selection)
                    onReaction(reaction.emoji)
                }
            }
            availableEmojis.forEach { emoji ->
                ReactionGlassChip(emoji) {
                    haptics.play(HapticEffect.Selection)
                    onReaction(emoji)
                }
            }
        }
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            MessageAction.entries.forEach { action ->
                TextButton(onClick = { haptics.play(HapticEffect.Light); onAction(action) }) {
                    Text(action.localizedLabel())
                }
            }
        }
        OperationStatus(state.operation)
    }
}

@Composable
private fun ReactionGlassChip(label: String, onClick: () -> Unit) {
    Box(
        Modifier
            .clip(CircleShape)
            .background(SpatialTheme.colors.glassSubtle)
            .border(0.75.dp, SpatialTheme.colors.glassBorderStart, CircleShape)
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 6.dp),
    ) {
        Text(label, style = MaterialTheme.typography.labelMedium, color = SpatialTheme.colors.textPrimary)
    }
}
