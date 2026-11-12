package com.outcomego.features

import android.graphics.Bitmap
import android.graphics.Color as AndroidColor
import android.graphics.pdf.PdfRenderer
import android.net.Uri
import android.os.ParcelFileDescriptor
import android.util.Log
import android.util.Xml
import android.widget.MediaController
import android.widget.VideoView
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.MusicNote
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import java.io.ByteArrayInputStream
import java.io.File
import java.io.InputStream
import java.util.concurrent.locks.ReentrantLock
import java.util.zip.ZipInputStream
import kotlin.concurrent.withLock
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import org.xmlpull.v1.XmlPullParser

private const val TEXT_PREVIEW_BYTES = 256 * 1024
private const val DOCUMENT_PREVIEW_CHARS = 400_000
private const val ARCHIVE_ENTRY_BYTES = 24 * 1024 * 1024
private const val SHEET_MAX_ROWS = 200
private const val SHEET_MAX_COLUMNS = 30

private enum class PreviewKind { Pdf, Docx, Sheet, Markdown, Json, Text, Video, Audio, None }

private val textExtensions = setOf(
    "txt", "log", "xml", "html", "yaml", "yml", "js", "ts", "py", "swift", "kt", "sh", "ini", "toml",
)
private val videoExtensions = setOf("mp4", "mov", "m4v", "webm", "mkv", "3gp")
private val audioExtensions = setOf("mp3", "m4a", "wav", "aac", "ogg", "flac")

private fun previewKind(attachment: Attachment): PreviewKind {
    val ext = attachment.name.substringAfterLast('.', "").lowercase()
    val mime = attachment.mimeType.lowercase()
    return when {
        mime.startsWith("video/") || ext in videoExtensions -> PreviewKind.Video
        mime.startsWith("audio/") || ext in audioExtensions -> PreviewKind.Audio
        ext == "pdf" || mime == "application/pdf" -> PreviewKind.Pdf
        ext == "docx" -> PreviewKind.Docx
        ext == "xlsx" || ext == "csv" || ext == "tsv" -> PreviewKind.Sheet
        ext == "json" || mime == "application/json" -> PreviewKind.Json
        ext == "md" || ext == "markdown" || ext == "mdx" -> PreviewKind.Markdown
        ext in textExtensions || mime.startsWith("text/") -> PreviewKind.Text
        else -> PreviewKind.None
    }
}

private sealed interface DocBlock
private class DocParagraph(val text: AnnotatedString, val heading: Int, val marker: String?, val level: Int) : DocBlock
private class DocTable(val rows: List<List<AnnotatedString>>, val wide: Boolean) : DocBlock

private sealed interface PreviewState {
    data object Loading : PreviewState
    data class Plain(val text: String, val markdown: Boolean, val truncated: Boolean) : PreviewState
    data class Document(val blocks: List<DocBlock>) : PreviewState
    data class Pdf(val document: PdfDocument) : PreviewState
    data class Failed(val message: String) : PreviewState
}

/** Renders PDF pages one at a time; closing waits for a page in flight so the renderer is never used after close. */
private class PdfDocument(context: android.content.Context, path: String) {
    private val lock = ReentrantLock()
    private var closed = false
    private val descriptor: ParcelFileDescriptor = Uri.parse(path).let { uri ->
        if (uri.scheme == "content") {
            context.contentResolver.openFileDescriptor(uri, "r") ?: error("The file could not be opened.")
        } else {
            ParcelFileDescriptor.open(File(if (uri.scheme == "file") uri.path ?: path else path), ParcelFileDescriptor.MODE_READ_ONLY)
        }
    }
    private val renderer = try {
        PdfRenderer(descriptor)
    } catch (error: Throwable) {
        descriptor.close()
        throw error
    }
    val pageCount: Int = renderer.pageCount

    suspend fun render(index: Int, widthPx: Int): Bitmap? = withContext(Dispatchers.IO) {
        lock.withLock {
            if (closed) return@withLock null
            renderer.openPage(index).use { page ->
                val height = (widthPx.toFloat() * page.height / page.width).toInt().coerceAtLeast(1)
                Bitmap.createBitmap(widthPx, height, Bitmap.Config.ARGB_8888).also {
                    it.eraseColor(AndroidColor.WHITE)
                    page.render(it, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                }
            }
        }
    }

    fun closeAsync() {
        CoroutineScope(Dispatchers.IO).launch {
            lock.withLock {
                if (closed) return@withLock
                closed = true
                renderer.close()
                descriptor.close()
            }
        }
    }
}

private fun readText(context: android.content.Context, path: String): Pair<String, Boolean> =
    openBitmapStream(context, path).use { stream ->
        val buffer = ByteArray(TEXT_PREVIEW_BYTES + 1)
        var read = 0
        while (read < buffer.size) {
            val count = stream.read(buffer, read, buffer.size - read)
            if (count < 0) break
            read += count
        }
        String(buffer, 0, minOf(read, TEXT_PREVIEW_BYTES), Charsets.UTF_8) to (read > TEXT_PREVIEW_BYTES)
    }

private val prettyJson = Json { prettyPrint = true }

/** Reads the named entries of a zip into memory, each bounded so a hostile archive can't exhaust the heap. */
private fun readZipEntries(stream: InputStream, wanted: (String) -> Boolean): Map<String, ByteArray> {
    val found = linkedMapOf<String, ByteArray>()
    ZipInputStream(stream).use { zip ->
        while (true) {
            val entry = zip.nextEntry ?: break
            if (!wanted(entry.name)) continue
            val out = java.io.ByteArrayOutputStream()
            val chunk = ByteArray(16 * 1024)
            var total = 0
            while (true) {
                val count = zip.read(chunk)
                if (count < 0) break
                total += count
                check(total <= ARCHIVE_ENTRY_BYTES) { "This document is too large to preview here. Download it to open the full file." }
                out.write(chunk, 0, count)
            }
            found[entry.name] = out.toByteArray()
        }
    }
    return found
}

/** The pull parser may or may not report namespace prefixes; compare local names only. */
private fun XmlPullParser.localName(): String = (name ?: "").substringAfter(':')

private fun XmlPullParser.attr(local: String): String? {
    for (index in 0 until attributeCount) {
        if (getAttributeName(index).substringAfter(':') == local) return getAttributeValue(index)
    }
    return null
}

private fun newParser(bytes: ByteArray): XmlPullParser =
    Xml.newPullParser().also { it.setInput(ByteArrayInputStream(bytes), null) }

private fun headingLevel(styleId: String?): Int {
    val id = styleId?.lowercase() ?: return 0
    if (id == "title") return 1
    if (id == "subtitle") return 3
    if (!id.startsWith("heading")) return 0
    return (id.removePrefix("heading").trim().toIntOrNull() ?: 1).coerceIn(1, 3)
}

private fun readDocx(stream: InputStream): List<DocBlock> {
    val entries = readZipEntries(stream) { it == "word/document.xml" }
    val xml = entries["word/document.xml"] ?: error("This document has no readable text.")
    return parseDocxXml(xml)
}

/** Walks WordprocessingML into paragraphs (headings, bullets, bold/italic runs) and tables. */
private fun parseDocxXml(xml: ByteArray): List<DocBlock> {
    val parser = newParser(xml)
    val blocks = mutableListOf<DocBlock>()
    var tableDepth = 0
    var rows = mutableListOf<List<AnnotatedString>>()
    var cells = mutableListOf<AnnotatedString>()
    var cellParagraphs = mutableListOf<AnnotatedString>()
    var builder = AnnotatedString.Builder()
    var heading = 0
    var bullet = false
    var numbered = false
    var level = 0
    var listCounter = 0
    var inParagraphProperties = false
    var inRunProperties = false
    var bold = false
    var italic = false
    var inText = false
    var total = 0
    var event = parser.eventType
    while (event != XmlPullParser.END_DOCUMENT && total < DOCUMENT_PREVIEW_CHARS) {
        when (event) {
            XmlPullParser.START_TAG -> when (parser.localName()) {
                "tbl" -> { tableDepth += 1; if (tableDepth == 1) rows = mutableListOf() }
                "tr" -> if (tableDepth == 1) cells = mutableListOf()
                "tc" -> if (tableDepth == 1) cellParagraphs = mutableListOf()
                "p" -> { builder = AnnotatedString.Builder(); heading = 0; bullet = false; numbered = false; level = 0 }
                "pPr" -> inParagraphProperties = true
                "pStyle" -> if (inParagraphProperties) {
                    val style = parser.attr("val").orEmpty()
                    heading = headingLevel(style)
                    if (style.startsWith("ListBullet", ignoreCase = true)) bullet = true
                    if (style.startsWith("ListNumber", ignoreCase = true)) numbered = true
                }
                "numPr" -> if (inParagraphProperties) bullet = true
                "ilvl" -> if (inParagraphProperties) level = parser.attr("val")?.toIntOrNull() ?: 0
                "r" -> { bold = false; italic = false }
                "rPr" -> inRunProperties = !inParagraphProperties
                "b" -> if (inRunProperties) bold = parser.attr("val") !in setOf("0", "false")
                "i" -> if (inRunProperties) italic = parser.attr("val") !in setOf("0", "false")
                "t" -> inText = true
                "tab" -> builder.append('\t')
                "br", "cr" -> builder.append('\n')
            }
            XmlPullParser.TEXT -> if (inText) {
                val style = SpanStyle(
                    fontWeight = if (bold) FontWeight.Bold else null,
                    fontStyle = if (italic) FontStyle.Italic else null,
                )
                builder.withStyle(style) { append(parser.text) }
            }
            XmlPullParser.END_TAG -> when (parser.localName()) {
                "t" -> inText = false
                "rPr" -> inRunProperties = false
                "pPr" -> inParagraphProperties = false
                "p" -> {
                    val text = builder.toAnnotatedString()
                    total += text.length + 1
                    if (tableDepth > 0) cellParagraphs.add(text)
                    else {
                        listCounter = if (numbered) listCounter + 1 else 0
                        val marker = if (numbered) "$listCounter." else if (bullet) "•" else null
                        blocks += DocParagraph(text, heading, marker, level)
                    }
                }
                "tc" -> if (tableDepth == 1) {
                    val joined = AnnotatedString.Builder()
                    cellParagraphs.forEachIndexed { index, paragraph ->
                        if (index > 0) joined.append('\n')
                        joined.append(paragraph)
                    }
                    cells.add(joined.toAnnotatedString())
                }
                "tr" -> if (tableDepth == 1) rows.add(cells)
                "tbl" -> {
                    if (tableDepth == 1 && rows.isNotEmpty()) blocks += DocTable(rows, wide = false)
                    tableDepth = (tableDepth - 1).coerceAtLeast(0)
                }
            }
        }
        event = parser.next()
    }
    check(blocks.any { it is DocTable || (it is DocParagraph && it.text.isNotBlank()) }) { "This document has no readable text." }
    return blocks
}

private fun columnIndex(reference: String): Int {
    var value = 0
    for (char in reference) {
        if (!char.isLetter()) break
        value = value * 26 + (char.uppercaseChar() - 'A' + 1)
    }
    return value - 1
}

private fun sharedStrings(xml: ByteArray?): List<String> {
    if (xml == null) return emptyList()
    val parser = newParser(xml)
    val strings = mutableListOf<String>()
    val current = StringBuilder()
    var inText = false
    var event = parser.eventType
    while (event != XmlPullParser.END_DOCUMENT) {
        when (event) {
            XmlPullParser.START_TAG -> when (parser.localName()) {
                "si" -> current.setLength(0)
                "t" -> inText = true
            }
            XmlPullParser.TEXT -> if (inText) current.append(parser.text)
            XmlPullParser.END_TAG -> when (parser.localName()) {
                "t" -> inText = false
                "si" -> strings += current.toString()
            }
        }
        event = parser.next()
    }
    return strings
}

/** The first worksheet, capped like the macOS preview: 200 rows by 30 columns. */
private fun readXlsx(stream: InputStream): List<List<String>> {
    val entries = readZipEntries(stream) { it == "xl/sharedStrings.xml" || (it.startsWith("xl/worksheets/sheet") && it.endsWith(".xml")) }
    val sheet = entries["xl/worksheets/sheet1.xml"]
        ?: entries.filterKeys { it.startsWith("xl/worksheets/") }.entries.minByOrNull { it.key }?.value
        ?: error("This spreadsheet is empty.")
    val strings = sharedStrings(entries["xl/sharedStrings.xml"])
    val parser = newParser(sheet)
    val grid = sortedMapOf<Int, MutableMap<Int, String>>()
    var rowIndex = -1
    var column = 0
    var type = ""
    var inValue = false
    var inInline = false
    val value = StringBuilder()
    var event = parser.eventType
    while (event != XmlPullParser.END_DOCUMENT) {
        when (event) {
            XmlPullParser.START_TAG -> when (parser.localName()) {
                "row" -> rowIndex = (parser.attr("r")?.toIntOrNull() ?: (rowIndex + 2)) - 1
                "c" -> {
                    column = parser.attr("r")?.let(::columnIndex) ?: (column + 1)
                    type = parser.attr("t").orEmpty()
                    value.setLength(0)
                }
                "v" -> inValue = true
                "is" -> inInline = true
                "t" -> if (inInline) inValue = true
            }
            XmlPullParser.TEXT -> if (inValue) value.append(parser.text)
            XmlPullParser.END_TAG -> when (parser.localName()) {
                "v", "t" -> inValue = false
                "is" -> inInline = false
                "c" -> if (rowIndex in 0 until SHEET_MAX_ROWS && column in 0 until SHEET_MAX_COLUMNS) {
                    val text = if (type == "s") strings.getOrNull(value.toString().trim().toIntOrNull() ?: -1).orEmpty() else value.toString()
                    if (text.isNotEmpty()) grid.getOrPut(rowIndex) { mutableMapOf() }[column] = text
                }
            }
        }
        event = parser.next()
    }
    check(grid.isNotEmpty()) { "This spreadsheet is empty." }
    val columns = grid.values.maxOf { it.keys.max() } + 1
    return (0..grid.lastKey()).map { row -> List(columns) { grid[row]?.get(it).orEmpty() } }
}

private fun readDelimited(text: String, delimiter: Char): List<List<String>> {
    val rows = mutableListOf<List<String>>()
    var row = mutableListOf<String>()
    val cell = StringBuilder()
    var quoted = false
    var index = 0
    fun endCell() { row.add(cell.toString()); cell.setLength(0) }
    fun endRow() { endCell(); rows.add(row.take(SHEET_MAX_COLUMNS)); row = mutableListOf() }
    while (index < text.length && rows.size < SHEET_MAX_ROWS) {
        val char = text[index]
        when {
            quoted && char == '"' && text.getOrNull(index + 1) == '"' -> { cell.append('"'); index += 1 }
            char == '"' -> quoted = !quoted
            !quoted && char == delimiter -> endCell()
            !quoted && char == '\n' -> endRow()
            !quoted && char == '\r' -> Unit
            else -> cell.append(char)
        }
        index += 1
    }
    if (rows.size < SHEET_MAX_ROWS && (cell.isNotEmpty() || row.isNotEmpty())) endRow()
    check(rows.isNotEmpty()) { "This spreadsheet is empty." }
    val columns = rows.maxOf { it.size }
    return rows.map { it + List(columns - it.size) { "" } }
}

private fun tableOf(rows: List<List<String>>) =
    PreviewState.Document(listOf(DocTable(rows.map { row -> row.map(::AnnotatedString) }, wide = true)))

/** Shows a downloaded file inside the app, as the macOS viewer does: PDF pages, Word and spreadsheet content, text, or media. */
@Composable
fun DocumentPreview(
    attachment: Attachment,
    onDownload: () -> Unit,
    onOpenExternally: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val path = attachment.localUri
    val kind = remember(attachment.name, attachment.mimeType) { previewKind(attachment) }
    if (path == null) {
        if (attachment.state == AttachmentState.Failed) {
            PreviewMessage(attachment, localizedText("Couldn’t download file", "文件下载失败"), null, modifier)
        } else {
            Box(modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 2.dp)
            }
        }
        return
    }
    if (kind == PreviewKind.None) {
        PreviewMessage(
            attachment,
            localizedText("Preview not available", "暂不支持预览"),
            localizedText(
                "This file type can’t be previewed. Download it to open it on your device.",
                "此类文件无法预览，请下载后在设备上打开。",
            ),
            modifier,
            actions = listOf(localizedText("Download", "下载") to onDownload),
        )
        return
    }
    if (kind == PreviewKind.Video || kind == PreviewKind.Audio) {
        MediaPlayer(attachment, path, audio = kind == PreviewKind.Audio, modifier)
        return
    }
    val state by produceState<PreviewState>(PreviewState.Loading, path, kind) {
        value = withContext(Dispatchers.IO) {
            runCatching<PreviewState> {
                when (kind) {
                    PreviewKind.Pdf -> PreviewState.Pdf(PdfDocument(context, path))
                    PreviewKind.Docx -> PreviewState.Document(openBitmapStream(context, path).use(::readDocx))
                    PreviewKind.Sheet -> {
                        val extension = attachment.name.substringAfterLast('.', "").lowercase()
                        if (extension == "xlsx") tableOf(openBitmapStream(context, path).use(::readXlsx))
                        else tableOf(readDelimited(readText(context, path).first, if (extension == "tsv") '\t' else ','))
                    }
                    PreviewKind.Markdown, PreviewKind.Text -> readText(context, path).let { (text, truncated) ->
                        PreviewState.Plain(text, kind == PreviewKind.Markdown, truncated)
                    }
                    PreviewKind.Json -> readText(context, path).let { (text, truncated) ->
                        val pretty = if (truncated) text else runCatching {
                            prettyJson.encodeToString(JsonElement.serializer(), Json.parseToJsonElement(text))
                        }.getOrDefault(text)
                        PreviewState.Plain(pretty, markdown = false, truncated = truncated)
                    }
                    else -> error("unreachable")
                }
            }.getOrElse {
                Log.w("DocumentPreview", "preview failed for ${attachment.name}", it)
                PreviewState.Failed(it.message.orEmpty())
            }
        }
    }
    when (val current = state) {
        PreviewState.Loading -> Box(modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 2.dp)
        }
        is PreviewState.Failed -> PreviewMessage(
            attachment,
            localizedText("Couldn’t read file", "无法读取此文件"),
            current.message.takeIf { it.isNotBlank() },
            modifier,
            actions = listOf(
                localizedText("Download", "下载") to onDownload,
                localizedText("Open with another app", "用其他应用打开") to onOpenExternally,
            ),
        )
        is PreviewState.Pdf -> {
            DisposableEffect(current.document) { onDispose { current.document.closeAsync() } }
            PdfPages(current.document, modifier)
        }
        is PreviewState.Document -> Paper(modifier) { DocumentBlocks(current.blocks) }
        is PreviewState.Plain -> Paper(modifier) {
            if (current.truncated) {
                Text(
                    localizedText("Showing the start of this file", "仅显示文件开头部分"),
                    color = Color(0xFF8A5A00),
                    fontSize = 12.sp,
                )
            }
            if (current.markdown) {
                MarkdownMessage(current.text, contentColor = PAPER_INK, containerColor = Color.White)
            } else {
                Text(current.text, color = PAPER_INK, fontFamily = FontFamily.Monospace, fontSize = 12.sp, lineHeight = 18.sp)
            }
        }
    }
}

private val PAPER_INK = Color(0xFF222222)
private val TABLE_LINE = Color(0xFFD9D9D9)

@Composable
private fun DocumentBlocks(blocks: List<DocBlock>) {
    blocks.forEach { block ->
        when (block) {
            is DocParagraph -> if (block.text.isEmpty()) {
                Box(Modifier.height(6.dp))
            } else {
                val size = when (block.heading) { 1 -> 24.sp; 2 -> 19.sp; 3 -> 16.sp; else -> 14.sp }
                Row(Modifier.padding(start = (block.level * 18).dp)) {
                    if (block.marker != null) Text(block.marker + "  ", color = PAPER_INK, fontSize = size, lineHeight = size * 1.55f)
                    Text(
                        block.text,
                        color = PAPER_INK,
                        fontSize = size,
                        lineHeight = if (block.heading > 0) size * 1.3f else size * 1.55f,
                        fontWeight = if (block.heading > 0) FontWeight.SemiBold else FontWeight.Normal,
                    )
                }
            }
            is DocTable -> DocumentTable(block)
        }
    }
}

@Composable
private fun DocumentTable(table: DocTable) {
    val columns = table.rows.maxOf { it.size }
    val scroll = if (table.wide) Modifier.horizontalScroll(rememberScrollState()) else Modifier
    Column(scroll) {
        table.rows.forEach { row ->
            Row(Modifier.height(IntrinsicSize.Min)) {
                repeat(columns) { column ->
                    Box(
                        (if (table.wide) Modifier.width(120.dp) else Modifier.weight(1f))
                            .fillMaxHeight()
                            .border(0.5.dp, TABLE_LINE)
                            .padding(horizontal = 8.dp, vertical = 6.dp),
                    ) {
                        Text(row.getOrNull(column) ?: AnnotatedString(""), color = PAPER_INK, fontSize = 12.sp, lineHeight = 17.sp)
                    }
                }
            }
        }
    }
}

@Composable
private fun PreviewMessage(
    attachment: Attachment,
    title: String,
    detail: String?,
    modifier: Modifier,
    actions: List<Pair<String, () -> Unit>> = emptyList(),
) {
    Column(
        modifier.fillMaxSize().padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        FileGlyph(attachment.name)
        Text(
            attachment.name,
            Modifier.padding(top = 16.dp),
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = FontWeight.Medium,
            textAlign = TextAlign.Center,
        )
        Text(
            title,
            Modifier.padding(top = 4.dp),
            style = MaterialTheme.typography.bodyMedium,
            textAlign = TextAlign.Center,
        )
        detail?.let {
            Text(
                it,
                Modifier.padding(top = 2.dp),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
        }
        actions.forEach { (label, onClick) -> TextButton(onClick = onClick) { Text(label) } }
    }
}

@Composable
private fun backdropColor(): Color = if (isSystemInDarkTheme()) Color(0xFF111111) else Color(0xFFECECEC)

/** A white sheet on a gray backdrop, like the macOS document viewer. */
@Composable
private fun Paper(modifier: Modifier, content: @Composable () -> Unit) {
    Box(modifier.fillMaxSize().background(backdropColor()).verticalScroll(rememberScrollState()).padding(12.dp)) {
        SelectionContainer {
            Column(
                Modifier.fillMaxWidth().heightIn(min = 240.dp).background(Color.White).padding(horizontal = 20.dp, vertical = 24.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) { content() }
        }
    }
}

@Composable
private fun PdfPages(document: PdfDocument, modifier: Modifier) {
    BoxWithConstraints(modifier.fillMaxSize().background(backdropColor())) {
        val widthPx = with(LocalDensity.current) { (maxWidth - 24.dp).roundToPx() }.coerceAtLeast(1)
        LazyColumn(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(8.dp), contentPadding = PaddingValues(12.dp)) {
            items(document.pageCount) { index ->
                val page by produceState<Bitmap?>(null, document, index, widthPx) { value = document.render(index, widthPx) }
                val bitmap = page
                if (bitmap != null) {
                    Image(bitmap.asImageBitmap(), contentDescription = null, Modifier.fillMaxWidth())
                } else {
                    Box(Modifier.fillMaxWidth().heightIn(min = 320.dp).background(Color.White), contentAlignment = Alignment.Center) {
                        CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                    }
                }
            }
        }
    }
}

/** Plays a video or audio file with the system transport controls, without starting on its own. */
@Composable
private fun MediaPlayer(attachment: Attachment, path: String, audio: Boolean, modifier: Modifier) {
    val uri = remember(path) {
        Uri.parse(path).takeIf { it.scheme != null } ?: Uri.fromFile(File(path))
    }
    val holder = remember(path) { arrayOfNulls<VideoView>(1) }
    DisposableEffect(path) { onDispose { holder[0]?.stopPlayback() } }
    Column(
        modifier.fillMaxSize().background(if (audio) backdropColor() else Color.Black),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        if (audio) {
            Icon(Icons.Default.MusicNote, contentDescription = null, Modifier.size(48.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(attachment.name, Modifier.padding(16.dp), style = MaterialTheme.typography.bodyMedium, textAlign = TextAlign.Center, color = Color(0xFF222222).takeIf { !isSystemInDarkTheme() } ?: Color.White)
        }
        AndroidView(
            factory = { context ->
                VideoView(context).apply {
                    holder[0] = this
                    val controller = MediaController(context)
                    controller.setAnchorView(this)
                    setMediaController(controller)
                    setOnPreparedListener { controller.show(0) }
                    setVideoURI(uri)
                }
            },
            modifier = if (audio) Modifier.fillMaxWidth().height(96.dp) else Modifier.fillMaxSize(),
        )
    }
}
