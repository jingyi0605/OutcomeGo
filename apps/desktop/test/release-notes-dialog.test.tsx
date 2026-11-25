import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ReleaseNotesMarkdown } from "../src/renderer/components/outcomego/settings/release-notes-dialog";

const render = (markdown: string) =>
  renderToStaticMarkup(<ReleaseNotesMarkdown>{markdown}</ReleaseNotesMarkdown>);

describe("release notes markdown", () => {
  test("renders headings, lists and code blocks", () => {
    const html = render(
      "## What's Changed\n* **Fix** the `badge`\n\n```sh\ncurl -fsSL https://example.test | sh\n```"
    );
    expect(html).toContain('data-streamdown="heading-2"');
    expect(html).toContain('data-streamdown="unordered-list"');
    expect(html).toContain('data-streamdown="inline-code"');
    expect(html).toContain('data-streamdown="code-block"');
    expect(html).toContain("release-notes");
  });

  test("opens links externally and shortens pull request URLs", () => {
    const html = render(
      "* Fix by @someone in https://github.com/outcomego/outcomego/pull/123\n* [Docs](https://example.test/docs)"
    );
    expect(html).toContain('href="https://github.com/outcomego/outcomego/pull/123"');
    expect(html).toContain(">#123</a>");
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noreferrer noopener"');
    expect(html).toContain(">Docs</a>");
    // Streamdown's default link renders a confirmation button instead of a link.
    expect(html).not.toContain('data-streamdown="link"');
  });

  test("drops raw html, images and script links", () => {
    const html = render(
      '<script>alert(1)</script>\n\n<img src="https://example.test/x.png">\n\n![shot](https://example.test/shot.png)\n\n[bad](javascript:alert(1))'
    );
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("javascript:");
  });
});
