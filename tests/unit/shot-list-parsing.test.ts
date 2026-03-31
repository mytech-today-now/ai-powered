/**
 * @file tests/unit/shot-list-parsing.test.ts
 *
 * Unit tests for parseJsonFile() and parseMdFile() from
 * integrations/web-example/shot-list-parsers.js.
 *
 * Test IDs follow the plan in openspec/changes/change-json/tests/shot-list-parsing.test-plan.md
 *
 * No network calls, no DOM, no server required.
 */

// @ts-ignore — plain JS module; types inferred as any
import { parseJsonFile, parseMdFile } from "../../integrations/web-example/shot-list-parsers.js";

// ---------------------------------------------------------------------------
// Suite: parseJsonFile — JSON array formats
// ---------------------------------------------------------------------------

describe("parseJsonFile — JSON array formats", () => {
  // T-SP-01
  it("T-SP-01: flat JSON array returns correct item", () => {
    const result = parseJsonFile('[{"name":"A","prompt":"Ocean","modality":"video"}]');
    expect(result).toEqual([{ name: "A", prompt: "Ocean", modality: "video" }]);
  });

  // T-SP-02
  it("T-SP-02: {shots:[…]} envelope extracts shots array", () => {
    const result = parseJsonFile('{"shots":[{"prompt":"Forest","modality":"text"}]}');
    expect(result).toEqual([{ name: "Shot 1", prompt: "Forest", modality: "text" }]);
  });

  // T-SP-03
  it("T-SP-03: {items:[…]} envelope extracts items array with default modality", () => {
    const result = parseJsonFile('{"items":[{"name":"B","prompt":"Sky"}]}');
    expect(result).toEqual([{ name: "B", prompt: "Sky", modality: "video" }]);
  });

  // T-SP-04
  it("T-SP-04: bare JSON object is treated as single-element array", () => {
    const result = parseJsonFile('{"name":"C","prompt":"Rain"}');
    expect(result).toEqual([{ name: "C", prompt: "Rain", modality: "video" }]);
  });
});

// ---------------------------------------------------------------------------
// Suite: parseJsonFile — JSONL / NDJSON fallback
// ---------------------------------------------------------------------------

describe("parseJsonFile — JSONL / NDJSON fallback", () => {
  // T-SP-05
  it("T-SP-05: NDJSON two-line input returns 2 items with default modality", () => {
    const result = parseJsonFile('{"prompt":"Sun"}\n{"name":"B","prompt":"Moon"}');
    expect(result).toHaveLength(2);
    expect(result[0].prompt).toBe("Sun");
    expect(result[1].name).toBe("B");
    expect(result[0].modality).toBe("video");
    expect(result[1].modality).toBe("video");
  });

  // T-SP-06
  it("T-SP-06: NDJSON skips blank lines", () => {
    const result = parseJsonFile('{"prompt":"A"}\n\n{"prompt":"B"}');
    expect(result).toHaveLength(2);
  });

  // T-SP-07
  it("T-SP-07: NDJSON with malformed line returns only valid items", () => {
    const result = parseJsonFile('{"prompt":"A"}\nnot-json\n{"prompt":"B"}');
    expect(result).toHaveLength(2);
    expect(result[0].prompt).toBe("A");
    expect(result[1].prompt).toBe("B");
  });
});

// ---------------------------------------------------------------------------
// Suite: parseJsonFile — default field values
// ---------------------------------------------------------------------------

describe("parseJsonFile — default field values", () => {
  // T-SP-08
  it("T-SP-08: missing modality defaults to 'video'", () => {
    const result = parseJsonFile('[{"prompt":"Dunes"}]');
    expect(result[0].modality).toBe("video");
  });

  // T-SP-09
  it("T-SP-09: missing name gets auto-names Shot 1, Shot 2", () => {
    const result = parseJsonFile('[{"prompt":"Wave"},{"prompt":"Cloud"}]');
    expect(result[0].name).toBe("Shot 1");
    expect(result[1].name).toBe("Shot 2");
  });

  // T-SP-10
  it("T-SP-10: present name is preserved as-is", () => {
    const result = parseJsonFile('[{"name":"My Shot","prompt":"Stars"}]');
    expect(result[0].name).toBe("My Shot");
  });
});

// ---------------------------------------------------------------------------
// Suite: parseJsonFile — empty / invalid inputs
// ---------------------------------------------------------------------------

describe("parseJsonFile — empty and invalid inputs", () => {
  // T-SP-11
  it("T-SP-11: empty JSON array returns []", () => {
    expect(parseJsonFile("[]")).toEqual([]);
  });

  // T-SP-12
  it("T-SP-12: completely invalid text returns [] without throwing", () => {
    expect(() => parseJsonFile("not json at all!!!")).not.toThrow();
    expect(parseJsonFile("not json at all!!!")).toEqual([]);
  });

  // T-SP-13
  it("T-SP-13: empty string returns []", () => {
    expect(parseJsonFile("")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Suite: parseMdFile — Markdown shot-list parsing
// ---------------------------------------------------------------------------

describe("parseMdFile — Markdown shot-list parsing", () => {
  // T-SP-14
  it("T-SP-14: single heading + paragraph", () => {
    const result = parseMdFile("## Shot Alpha\n\nA mountain lake at sunrise");
    expect(result).toEqual([
      { name: "Shot Alpha", prompt: "A mountain lake at sunrise", modality: "video" },
    ]);
  });

  // T-SP-15
  it("T-SP-15: multiple heading+paragraph blocks return items in document order", () => {
    const md = "## One\n\nFirst\n\n## Two\n\nSecond\n\n## Three\n\nThird";
    const result = parseMdFile(md);
    expect(result).toHaveLength(3);
    expect(result[0].name).toBe("One");
    expect(result[1].name).toBe("Two");
    expect(result[2].name).toBe("Three");
  });

  // T-SP-16
  it("T-SP-16: paragraph before first heading uses auto-name 'Shot 1'", () => {
    const md = "A lone wolf howling\n\n## Scene 2\n\nCity skyline";
    const result = parseMdFile(md);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe("Shot 1");
    expect(result[0].prompt).toBe("A lone wolf howling");
    expect(result[1].name).toBe("Scene 2");
    expect(result[1].prompt).toBe("City skyline");
  });

  // T-SP-17
  it("T-SP-17: all modalities default to 'video'", () => {
    const result = parseMdFile("## Shot One\n\nA desert dune\n\n## Shot Two\n\nA snowy peak");
    expect(result.every((item) => item.modality === "video")).toBe(true);
  });

  // T-SP-18
  it("T-SP-18: H1, H2, H3 headings all accepted as shot names", () => {
    const md = "# Title\n\nPrompt one\n\n## Sub\n\nPrompt two\n\n### Deep\n\nPrompt three";
    const result = parseMdFile(md);
    expect(result).toHaveLength(3);
    expect(result.map((r) => r.name)).toEqual(["Title", "Sub", "Deep"]);
  });

  // T-SP-19
  it("T-SP-19: empty Markdown file returns []", () => {
    expect(parseMdFile("")).toEqual([]);
  });

  // T-SP-20: heading with no paragraph → 0 items (no prompt = not emitted)
  it("T-SP-20: heading only (no paragraph text) returns 0 items", () => {
    const result = parseMdFile("## Header Only");
    expect(result).toHaveLength(0);
  });
});

