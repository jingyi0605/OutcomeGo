export const STREAM_REPLY_TOOL = "StreamReplyToUser";
export const REPLY_PREVIEW_CONTROL = "PublishReplyPreview";
export const MAX_REPLY_PREVIEW_CHARS = 8_000;

export interface ReplyPreview {
  runId: string;
  clientId: string;
  content: string;
}

export interface ReplyPreviewSnapshot {
  revision: string;
  preview: ReplyPreview | null;
}
