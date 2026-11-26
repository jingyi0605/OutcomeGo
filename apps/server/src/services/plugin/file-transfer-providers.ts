import { CONNECTOR_TRANSFER_MAX_BYTES } from "@outcomego/contracts/connector-transfers";
import { basename, extname } from "node:path";
const part = encodeURIComponent;
const transferError = (kind: string, message: string, extra: Record<string, unknown> = {}) => Object.assign(new Error(message), {outcome:{kind,message,...extra}});
const drive = "https://www.googleapis.com/drive/v3";
const exports: Record<string, [string, string]> = {
  "application/vnd.google-apps.document": [
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".docx",
  ],
  "application/vnd.google-apps.spreadsheet": [
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".xlsx",
  ],
  "application/vnd.google-apps.presentation": [
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".pptx",
  ],
  "application/vnd.google-apps.drawing": ["image/png", ".png"],
};
const mimeFor = (name: string) =>
  ({
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".txt": "text/plain",
    ".csv": "text/csv",
    ".json": "application/json",
    ".docx": exports["application/vnd.google-apps.document"]![0],
    ".xlsx": exports["application/vnd.google-apps.spreadsheet"]![0],
    ".pptx": exports["application/vnd.google-apps.presentation"]![0],
    ".ppt": "application/vnd.ms-powerpoint",
    ".odp": "application/vnd.oasis.opendocument.presentation",
    ".doc": "application/msword",
    ".odt": "application/vnd.oasis.opendocument.text",
    ".rtf": "application/rtf",
    ".html": "text/html",
    ".md": "text/markdown",
    ".xls": "application/vnd.ms-excel",
    ".ods": "application/vnd.oasis.opendocument.spreadsheet",
    ".tsv": "text/tab-separated-values",
  })[extname(name).toLowerCase()] ?? "application/octet-stream";
// What Drive imports each convertible type as when an upload asks for a native Google file.
const googleTypeFor = (name: string): string | undefined => {
  const extension = extname(name).toLowerCase();
  if ([".pptx", ".ppt", ".odp"].includes(extension)) return "application/vnd.google-apps.presentation";
  if ([".docx", ".doc", ".odt", ".rtf", ".html", ".md", ".txt"].includes(extension))
    return "application/vnd.google-apps.document";
  if ([".xlsx", ".xls", ".ods", ".csv", ".tsv"].includes(extension))
    return "application/vnd.google-apps.spreadsheet";
  return undefined;
};
export class FileTransferProvider {
  constructor(
    private readonly token: string,
    private readonly fetcher: typeof fetch = fetch
  ) {}
  private async response(
    url: string,
    init: RequestInit = {},
    authenticated = true,
    allowIncomplete = false
  ): Promise<Response> {
    let response: Response;
    try {
      response = await this.fetcher(url, {
        ...init,
        headers: {
          ...(authenticated ? { authorization: `Bearer ${this.token}` } : {}),
          ...init.headers,
        },
        signal: init.signal ?? AbortSignal.timeout(120_000),
        redirect: "manual",
      });
    } catch {
      throw new Error(
        "File provider connection failed or was cancelled; no automatic write retry was attempted"
      );
    }
    if (!response.ok && !(allowIncomplete && response.status === 308))
      throw Object.assign(new Error(`File provider request failed (${response.status}); no automatic write retry was attempted`), {status:response.status});
    return response;
  }
  private async json(url: string, init: RequestInit = {}): Promise<any> {
    const bytes = await this.bytes(
      await this.response(url, init),
      Math.ceil((CONNECTOR_TRANSFER_MAX_BYTES * 4) / 3) + 1024 * 1024
    );
    try {
      return JSON.parse(bytes.toString("utf8"));
    } catch {
      throw new Error("File provider returned invalid JSON");
    }
  }
  private async bytes(response: Response, limit = CONNECTOR_TRANSFER_MAX_BYTES): Promise<Buffer> {
    if (Number(response.headers.get("content-length")) > limit)
      throw new Error("Provider response exceeds transfer limit");
    const reader = response.body?.getReader();
    if (!reader) return Buffer.alloc(0);
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > limit) throw new Error("Provider response exceeds transfer limit");
        chunks.push(value);
      }
      return Buffer.concat(chunks);
    } finally {
      await reader.cancel().catch(() => {});
    }
  }
  async download(
    provider: string,
    source: { fileId?: string; path?: string },
    signal?: AbortSignal
  ): Promise<{ id: string; name: string; mimeType: string; bytes: Buffer; webUrl?: string }> {
    const result = await this.downloadStream(provider,source,signal);
    return {...result,bytes:await this.bytes(new Response(result.stream))};
  }
  async downloadStream(provider:string,source:{fileId?:string;path?:string},signal?:AbortSignal): Promise<{id:string;name:string;mimeType:string;stream:ReadableStream<Uint8Array>;webUrl?:string}> {
    if (provider === "google-drive") {
      if (!source.fileId) throw transferError("rejected", "Drive requires source.fileId");
      const id = source.fileId;
      const file = await this.json(
        `${drive}/files/${part(id)}?fields=id,name,mimeType,size,webViewLink&supportsAllDrives=true`,
        { signal }
      );
      const native = exports[file.mimeType];
      if (file.mimeType?.startsWith("application/vnd.google-apps.") && !native)
        throw transferError("rejected", "This Google native file type cannot be exported");
      const url = native
        ? `${drive}/files/${part(id)}/export?mimeType=${part(native[0])}`
        : `${drive}/files/${part(id)}?alt=media&supportsAllDrives=true`;
      return {
        id,
        name: file.name + (native && !file.name.endsWith(native[1]) ? native[1] : ""),
        mimeType: native?.[0] ?? file.mimeType,
        stream: (await this.response(url, {signal})).body ?? new ReadableStream({start(c){c.close();}}),
        webUrl: file.webViewLink,
      };
    }
    throw new Error("Connection cannot transfer files");
  }
  async upload(
    provider: string,
    sourceName: string,
    destination: Record<string, any>,
    bytes: Buffer | Blob,
    signal?: AbortSignal
  ): Promise<Record<string, any>> {
    const size = Buffer.isBuffer(bytes) ? bytes.length : bytes.size;
    const chunk = async (start:number,end:number) => Buffer.isBuffer(bytes) ? new Uint8Array(bytes.subarray(start,end)) : new Uint8Array(await bytes.slice(start,end).arrayBuffer());
    const name = destination.name ?? basename(sourceName);
    // A destination name without an extension keeps the source file's type.
    const typedName = extname(name) ? name : basename(sourceName);
    const mimeType = mimeFor(typedName);
    if (destination.draftId) throw transferError("invalid_destination", "draftId is not supported");
    if (provider === "google-drive") {
      if (destination.overwrite !== undefined)
        throw transferError("invalid_destination", "Google Drive always creates a new file; overwrite is not supported");
      let parent = destination.folderId ?? "root";
      if (destination.path) {
        for (const segment of destination.path.split("/")) {
          if (!segment || [".", ".."].includes(segment))
            throw transferError("invalid_destination", "Invalid Drive folder path");
          const escape = (x: string) => x.replaceAll("\\", "\\\\").replaceAll("'", "\\'");
          const query = `'${escape(parent)}' in parents and name = '${escape(segment)}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
          const folders = await this.json(
            `${drive}/files?q=${part(query)}&fields=files(id),nextPageToken&pageSize=2&supportsAllDrives=true&includeItemsFromAllDrives=true`,
            { signal }
          );
          if (folders.files?.length !== 1 || folders.nextPageToken)
            throw transferError("invalid_destination", "Drive folder is missing or ambiguous");
          parent = folders.files[0].id;
        }
      }
      const start = await this.response(
        "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id,name,mimeType,size,webViewLink",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-upload-content-type": mimeType,
            "x-upload-content-length": String(size),
          },
          body: JSON.stringify({
            name,
            mimeType: (destination.convertToGoogleFormat === true && googleTypeFor(typedName)) || mimeType,
            parents: [parent],
          }),
          signal,
        }
      );
      const location = new URL(start.headers.get("location") ?? "");
      if (
        location.origin !== "https://www.googleapis.com" ||
        !location.pathname.startsWith("/upload/drive/")
      )
        throw new Error("Invalid Drive upload session");
      let file: any;
      const block = 8 * 1024 * 1024; // Multiple of Drive's 256 KiB fragment unit.
      for (let offset = 0; offset < Math.max(size,1); offset += block) {
        const end = Math.min(size,offset+block);
        const response = await this.response(location.href, {
          method:"PUT",headers:{"content-type":mimeType,"content-range":size ? `bytes ${offset}-${end-1}/${size}` : "bytes */0"},
          body:await chunk(offset,end),signal,
        },true,true);
        if (response.status === 308) {
          if (end === size || response.headers.get("range") !== `bytes=0-${end-1}`) throw new Error("Drive did not confirm the uploaded range; inspect the destination before retrying");
        } else { file=await response.json(); if(end!==size)throw new Error("Drive completed before receiving the full file"); }
      }
      if(!file?.id)throw new Error("Drive did not confirm completion; inspect the destination before retrying");
      return {
        id: file.id,
        name: file.name,
        mimeType: file.mimeType ?? mimeType,
        sizeBytes: size,
        webUrl: file.webViewLink,
      };
    }
    throw new Error("Connection cannot receive files");
  }
}
