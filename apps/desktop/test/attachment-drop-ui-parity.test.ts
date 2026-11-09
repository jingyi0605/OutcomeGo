import { describe, expect, it } from "bun:test";

import { fileDragContainsFiles, filesFromClipboard } from "../src/renderer/lib/file-drop";

describe("desktop attachment drop parity", () => {
  it("only activates for native file drags", () => {
    expect(fileDragContainsFiles({ types: ["Files"] })).toBe(true);
    expect(fileDragContainsFiles({ types: ["text/plain", "Files"] })).toBe(true);
    expect(fileDragContainsFiles({ types: ["text/plain"] })).toBe(false);
    expect(fileDragContainsFiles(null)).toBe(false);
  });

  it("keeps document files when they are pasted into the composer", () => {
    const pdf = new File(["pdf"], "brief.pdf", { type: "application/pdf" });
    const docx = new File(["docx"], "brief.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });

    expect(filesFromClipboard({ files: [pdf, docx] })).toEqual([pdf, docx]);
  });
});
