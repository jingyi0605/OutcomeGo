import { test, expect } from "bun:test";
import { FileTransferProvider } from "../../src/services/plugin/file-transfer-providers";
import { CONNECTOR_TRANSFER_TOOLS, parseConnectorTransfer } from "@outcomego/contracts/connector-transfers";

test("retired file providers cannot issue requests and are absent from tool guidance", async () => {
  const provider = new FileTransferProvider("fixture", (async (_url: any, _init?: RequestInit): Promise<Response> => {
    throw new Error("Unexpected provider request");
  }) as typeof fetch);
  for (const retired of ["onedrive", "gmail"]) {
    await expect(provider.download(retired, { fileId: "file" })).rejects.toThrow("Connection cannot transfer files");
    await expect(provider.upload(retired, "file.txt", {}, Buffer.from("fixture"))).rejects.toThrow("Connection cannot receive files");
  }
  for (const tool of CONNECTOR_TRANSFER_TOOLS) {
    expect(JSON.stringify(tool)).not.toMatch(/onedrive|sharepoint|outlook|gmail|send_draft|send_message|read_email/i);
    expect(tool.description).toContain("The service short name (google-drive)");
  }
  expect(CONNECTOR_TRANSFER_TOOLS.find(t => t.name === "UploadFile")!.inputSchema.properties.destination.properties.draftId).toBeUndefined();
  expect(CONNECTOR_TRANSFER_TOOLS.find(t => t.name === "DownloadFile")!.inputSchema.properties.source.required).toEqual(["fileId"]);
  expect(() => parseConnectorTransfer("DownloadFile", { connection: "drive", source: { path: "file.txt" } })).toThrow("source.fileId");
  expect(() => parseConnectorTransfer("UploadFile", { connection: "drive", sourcePath: "/workspace/file.txt", destination: { overwrite: true } })).toThrow("destination.overwrite");
  expect(() => parseConnectorTransfer("UploadFile", { connection: "drive", sourcePath: "/workspace/file.txt", destination: { draftId: "draft-1" } })).toThrow("destination.draftId");
});

test("Drive export preserves native document bytes and upload uses an authenticated resumable session", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetcher = (async (url: any, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer synthetic-oauth");
    if (String(url).includes("/export?")) return new Response(new Uint8Array([0, 1, 254, 255]));
    if (init.method === "PUT") {
      expect([...new Uint8Array(init.body as any)]).toEqual([0, 1, 254, 255]);
      return Response.json({ id: "uploaded", name: "report.docx" });
    }
    if (String(url).includes("/upload/"))
      return new Response(null, {
        headers: { location: "https://www.googleapis.com/upload/drive/v3/files?upload_id=fixture" },
      });
    return Response.json({
      id: "native",
      name: "report",
      mimeType: "application/vnd.google-apps.document",
    });
  }) as typeof fetch;
  const provider = new FileTransferProvider("synthetic-oauth", fetcher);
  const download = await provider.download("google-drive", { fileId: "native" });
  expect(download.name).toBe("report.docx");
  expect([...download.bytes]).toEqual([0, 1, 254, 255]);
  expect(await provider.upload("google-drive", download.name, {}, download.bytes)).toMatchObject({
    id: "uploaded",
    sizeBytes: 4,
  });
  expect(
    calls.some((c) =>
      c.url.includes(
        encodeURIComponent(
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        )
      )
    )
  ).toBe(true);
});

test("file contracts reject destination ambiguity and unsafe filename shapes", () => {
  for (const args of [
    { connection: "x", sourcePath: "/workspace/a", destination: { path: "a", folderId: "b" } },
    { connection: "x", sourcePath: "/workspace/a", destination: { name: "../a" } },
  ])
    expect(() => parseConnectorTransfer("UploadFile", args)).toThrow();
  expect(() =>
    parseConnectorTransfer("DownloadFile", { connection: "x", source: { fileId: "a", path: "b" } })
  ).toThrow();
});

test("Drive imports an Office file as a native Google file only when the upload asks for it", async () => {
  const pptx = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  const starts: Array<{ metadata: any; contentType: string | null }> = [];
  const fetcher = (async (url: any, init: RequestInit = {}) => {
    if (String(url).includes("uploadType=resumable")) {
      starts.push({ metadata: JSON.parse(String(init.body)), contentType: new Headers(init.headers).get("x-upload-content-type") });
      return new Response(null, { headers: { location: "https://www.googleapis.com/upload/drive/v3/files?upload_id=fixture" } });
    }
    expect(new Headers(init.headers).get("content-type")).toBe(pptx);
    const converted = starts.at(-1)!.metadata.mimeType;
    return Response.json({ id: "deck", name: "Q3 review.pptx", mimeType: converted, webViewLink: "https://docs.google.com/presentation/d/deck" });
  }) as typeof fetch;
  const provider = new FileTransferProvider("synthetic-oauth", fetcher);
  const bytes = Buffer.from("pptx-bytes");

  expect(await provider.upload("google-drive", "Q3 review.pptx", { convertToGoogleFormat: true }, bytes)).toMatchObject({
    mimeType: "application/vnd.google-apps.presentation",
  });
  expect(await provider.upload("google-drive", "Q3 review.pptx", {}, bytes)).toMatchObject({ mimeType: pptx });
  // A destination name without an extension still converts from the source file's type.
  expect(
    await provider.upload("google-drive", "/workspace/slides/deck/q3.pptx", { name: "Q3 review", convertToGoogleFormat: true }, bytes)
  ).toMatchObject({ mimeType: "application/vnd.google-apps.presentation" });
  expect(starts.map((start) => [start.metadata.name, start.metadata.mimeType, start.contentType])).toEqual([
    ["Q3 review.pptx", "application/vnd.google-apps.presentation", pptx],
    ["Q3 review.pptx", pptx, pptx],
    ["Q3 review", "application/vnd.google-apps.presentation", pptx],
  ]);

  const contract = CONNECTOR_TRANSFER_TOOLS.find((tool) => tool.name === "UploadFile")!;
  expect(contract.inputSchema.properties.destination.properties.convertToGoogleFormat.type).toBe("boolean");
  expect(contract.description).toContain("destination.convertToGoogleFormat, when true, asks Drive to import");
  expect(
    parseConnectorTransfer("UploadFile", {
      connection: "google-drive",
      sourcePath: "/workspace/deck.pptx",
      destination: { convertToGoogleFormat: true },
    }).destination
  ).toEqual({ convertToGoogleFormat: true });
});
