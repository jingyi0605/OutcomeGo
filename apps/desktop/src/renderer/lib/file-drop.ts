export const fileDragContainsFiles = (dataTransfer: Pick<DataTransfer, "types"> | null) =>
  Array.from(dataTransfer?.types ?? []).includes("Files");

export const filesFromClipboard = (
  clipboardData: Pick<DataTransfer, "files"> | null | undefined
): File[] => Array.from(clipboardData?.files ?? []);
