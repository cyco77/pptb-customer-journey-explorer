import { describe, expect, it } from "vitest";
import { formatHtmlSource, formatSourceText, tokenizeSourceText } from "./sourceFormatting";

describe("source formatting", () => {
  it("pretty-prints valid JSON", () => {
    expect(formatSourceText('{"name":"Journey","count":2}')).toBe(JSON.stringify({ name: "Journey", count: 2 }, null, 2));
  });

  it("indents HTML elements onto separate lines", () => {
    expect(formatHtmlSource("<div><span>Value</span></div>")).toBe("<div>\n  <span>\n    Value\n  </span>\n</div>");
  });

  it("leaves malformed JSON and plain text unchanged", () => {
    expect(formatSourceText("{broken json")).toBe("{broken json");
    expect(formatSourceText("plain text")).toBe("plain text");
  });

  it("assigns syntax token kinds for JSON and HTML source", () => {
    const json = '{\n  "name": "Journey",\n  "active": true\n}';
    expect(tokenizeSourceText(json).map((token) => token.kind)).toEqual([
      "jsonPunctuation", "jsonKey", "jsonPunctuation", "jsonString", "jsonPunctuation", "jsonKey", "jsonPunctuation", "jsonLiteral", "jsonPunctuation",
    ]);

    const html = "<a href=\"/journeys\">Open</a>";
    expect(tokenizeSourceText(html).map((token) => token.kind)).toContain("htmlTag");
    expect(tokenizeSourceText(html).map((token) => token.kind)).toContain("htmlAttribute");
    expect(tokenizeSourceText(html).map((token) => token.kind)).toContain("htmlValue");
  });
});
