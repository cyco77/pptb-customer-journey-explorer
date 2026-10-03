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

  it("preserves blank text and formats arrays as JSON", () => {
    expect(formatSourceText(" \n\t ")).toBe(" \n\t ");
    expect(formatSourceText('["one",2]')).toBe('[\n  "one",\n  2\n]');
  });

  it("indents self-closing and void tags without increasing nesting depth", () => {
    expect(formatHtmlSource("<div><br/><img src='x'><span>Text</span></div>")).toBe(
      "<div>\n  <br/>\n  <img src='x'>\n  <span>\n    Text\n  </span>\n</div>",
    );
    expect(formatHtmlSource("</div><p>Text</p>")).toBe("</div>\n<p>\n  Text\n</p>");
  });

  it("tokenizes empty, malformed, primitive, and HTML-document input", () => {
    expect(tokenizeSourceText("  ")).toEqual([]);
    expect(tokenizeSourceText("{broken")).toEqual([]);
    expect(tokenizeSourceText("plain text")).toEqual([]);
    expect(tokenizeSourceText("42 true false null").map((token) => token.kind)).toEqual([]);
    expect(tokenizeSourceText("<!doctype html><!-- note --><input value='x'>").map((token) => token.kind)).toContain("htmlComment");
    expect(tokenizeSourceText("<!doctype html><!-- note --><input value='x'>").map((token) => token.kind)).toContain("htmlValue");
  });

  it("classifies JSON numbers, booleans, null, and escaped strings", () => {
    const tokens = tokenizeSourceText('{"count":-2.5,"active":false,"missing":null,"text":"a\\\"b"}');
    expect(tokens.map((token) => token.kind)).toContain("jsonNumber");
    expect(tokens.filter((token) => token.kind === "jsonLiteral")).toHaveLength(2);
    expect(tokens.some((token) => token.kind === "jsonString" && token.end > token.start)).toBe(true);
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
