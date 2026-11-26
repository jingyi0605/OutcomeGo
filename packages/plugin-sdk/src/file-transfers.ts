export function fileTransferCapabilities(provider: string) {
  return ["google-drive"].includes(provider) ? { upload: true, download: true } : undefined;
}
