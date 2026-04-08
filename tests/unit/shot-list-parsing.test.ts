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
import {
  parseJsonFile,
  parseMdFile,
  _buildItem,
} from "../../integrations/web-example/shot-list-parsers.js";

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

// ---------------------------------------------------------------------------
// Suite: parseJsonFile — constraint field preservation (ST-4.1, ST-4.2, ST-4.3)
// ---------------------------------------------------------------------------

describe("parseJsonFile — constraint field preservation", () => {
  // T-SP-21 (ST-4.1)
  it("T-SP-21: JSON array entry with duration is preserved on the returned item", () => {
    const input = JSON.stringify([
      { name: "A", prompt: "Ocean", duration: 9 },
      { name: "B", prompt: "Forest" },
    ]);
    const result = parseJsonFile(input);
    expect(result[0].duration).toBe(9);
    expect("duration" in result[1]).toBe(false); // absent, not undefined
  });

  // T-SP-22 (ST-4.2)
  it("T-SP-22: JSON array entry with all seven constraint fields passes them through", () => {
    const entry = {
      name: "Hero",
      prompt: "Landscape",
      duration: 10,
      fps: 30,
      aspectRatio: "16:9",
      resolution: "4k",
      quality: "high",
      width: 3840,
      height: 2160,
    };
    const result = parseJsonFile(JSON.stringify([entry]));
    const item = result[0];
    expect(item.duration).toBe(10);
    expect(item.fps).toBe(30);
    expect(item.aspectRatio).toBe("16:9");
    expect(item.resolution).toBe("4k");
    expect(item.quality).toBe("high");
    expect(item.width).toBe(3840);
    expect(item.height).toBe(2160);
  });

  // T-SP-23 (ST-4.3)
  it("T-SP-23: NDJSON (non-array) lines preserve duration per shot", () => {
    // Simulate NDJSON: not a valid JSON array, triggers line-by-line fallback
    const input = [
      JSON.stringify({ name: "A", prompt: "P1", duration: 4 }),
      JSON.stringify({ name: "B", prompt: "P2", duration: 7 }),
    ].join("\n");
    const result = parseJsonFile(input);
    expect(result[0].duration).toBe(4);
    expect(result[1].duration).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// Suite: parseMdFile — no constraint fields (ST-4.4)
// Suite: parseJsonFile — absent fields are truly absent (ST-4.5)
// ---------------------------------------------------------------------------

describe("parseMdFile — constraint fields absent (ST-4.4)", () => {
  // T-SP-24 (ST-4.4)
  it("T-SP-24: parseMdFile() items have no constraint fields", () => {
    const md = "# Shot A\n\nBeautiful sunrise.\n\n# Shot B\n\nOcean waves.\n";
    const result = parseMdFile(md);
    expect(result.length).toBe(2);
    expect("duration" in result[0]).toBe(false);
    expect("fps" in result[0]).toBe(false);
    expect("aspectRatio" in result[0]).toBe(false);
  });
});

describe("parseJsonFile — absent constraint fields are truly absent (ST-4.5)", () => {
  // T-SP-25 (ST-4.5)
  it("T-SP-25: parseJsonFile() absent constraint field is absent from item, not undefined", () => {
    const input = JSON.stringify([{ name: "X", prompt: "Test" }]);
    const result = parseJsonFile(input);
    const item = result[0];
    // Key must be absent entirely (not set to undefined)
    expect("duration" in item).toBe(false);
    expect("fps" in item).toBe(false);
    expect("aspectRatio" in item).toBe(false);
    expect("resolution" in item).toBe(false);
    expect("quality" in item).toBe(false);
    expect("width" in item).toBe(false);
    expect("height" in item).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Suite: parseJsonFile — references map (P-REF-04, P-REF-05, P-REF-11)
// ---------------------------------------------------------------------------

describe("parseJsonFile — references map support", () => {
  // P-REF-04: JSONL _type:"references" sentinel is consumed, not emitted as a shot
  it("P-REF-04: JSONL _type:references sentinel consumed without being emitted as a shot", () => {
    const heroUrl = "https://img.example.com/hero.jpg";
    const sunriseUrl = "https://img.example.com/sunrise.jpg";
    const lines = [
      JSON.stringify({ _type: "references", hero: heroUrl, sunrise: sunriseUrl }),
      JSON.stringify({ name: "Shot A", prompt: "Mountain lake", references: ["hero"] }),
      JSON.stringify({ name: "Shot B", prompt: "Desert dunes", references: ["sunrise"] }),
      JSON.stringify({ name: "Shot C", prompt: "City skyline" }),
    ].join("\n");
    const result = parseJsonFile(lines);
    // Only 3 shots (sentinel not emitted)
    expect(result).toHaveLength(3);
    expect(result[0].name).toBe("Shot A");
    expect(result[0].images).toEqual([heroUrl]);
    expect(result[1].name).toBe("Shot B");
    expect(result[1].images).toEqual([sunriseUrl]);
    // Shot C has no references → no images key
    expect("images" in result[2]).toBe(false);
  });

  // P-REF-05: JSONL mid-stream sentinel updates globalRefs for subsequent shots only
  it("P-REF-05: JSONL mid-stream sentinel updates globalRefs; pre-sentinel shots unaffected", () => {
    const url = "https://img.example.com/scene.jpg";
    const lines = [
      JSON.stringify({ name: "Before", prompt: "Before sentinel", references: ["scene"] }),
      JSON.stringify({ _type: "references", scene: url }),
      JSON.stringify({ name: "After", prompt: "After sentinel", references: ["scene"] }),
    ].join("\n");
    const result = parseJsonFile(lines);
    expect(result).toHaveLength(2);
    // Before sentinel: key "scene" unknown → no images
    expect("images" in result[0]).toBe(false);
    // After sentinel: key "scene" resolved
    expect(result[1].images).toEqual([url]);
  });

  // P-REF-11: JSON object with root references map and key-array references per shot
  it("P-REF-11: JSON object root references map resolved via per-shot key array", () => {
    const startUrl = "https://img.example.com/start.jpg";
    const endUrl = "https://img.example.com/end.jpg";
    const input = JSON.stringify({
      references: { start: startUrl, end: endUrl },
      shots: [
        { name: "Two-Frame", prompt: "Keyframe shot", references: ["start", "end"] },
        { name: "Single", prompt: "Single frame", references: ["start"] },
      ],
    });
    const result = parseJsonFile(input);
    expect(result).toHaveLength(2);
    expect(result[0].images).toEqual([startUrl, endUrl]);
    expect(result[1].images).toEqual([startUrl]);
  });
});

// ---------------------------------------------------------------------------
// Suite: parseMdFile — References section (P-REF-06, P-REF-07)
// ---------------------------------------------------------------------------

describe("parseMdFile — ## References section support", () => {
  const heroUrl = "https://img.example.com/hero.jpg";
  const bgUrl = "https://img.example.com/bg.jpg";

  // P-REF-06: ## References heading is NOT emitted as a shot; bullets populate globalRefs
  it("P-REF-06: ## References section populates globalRefs and is not emitted as a shot", () => {
    const md = [
      "## References",
      `- hero: ${heroUrl}`,
      `- bg: ${bgUrl}`,
      "",
      "## Scene One",
      "Mountain lake at dawn.",
      "**References:** hero, bg",
    ].join("\n");

    const result = parseMdFile(md);

    // Only one shot emitted (the ## References heading itself should NOT appear)
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Scene One");
    expect(result[0].prompt).toBe("Mountain lake at dawn.");
    expect(result[0].images).toEqual([heroUrl, bgUrl]);
  });

  // P-REF-07: **References:** Key1, Key2 resolves against globalRefs; unknown keys dropped
  it("P-REF-07: **References:** keys resolved in order; unknown key silently dropped", () => {
    const md = [
      "## References",
      `- hero: ${heroUrl}`,
      "",
      "## Shot Alpha",
      "Desert dunes at sunset.",
      "**References:** hero, missing-key",
      "",
      "## Shot Beta",
      "City skyline.",
    ].join("\n");

    const result = parseMdFile(md);

    expect(result).toHaveLength(2);

    // Shot Alpha: "hero" resolves, "missing-key" is silently dropped
    expect(result[0].name).toBe("Shot Alpha");
    expect(result[0].images).toEqual([heroUrl]);

    // Shot Beta: no **References:** line → no images key
    expect(result[1].name).toBe("Shot Beta");
    expect("images" in result[1]).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Suite: _buildItem — reference resolution priority cascade (P-REF)
// ---------------------------------------------------------------------------

describe("_buildItem — reference resolution priority cascade", () => {
  // P-REF-01: references is array → key-list lookup in merged globalRefs + _inlineRefs
  it("P-REF-01: references array resolves keys from globalRefs", () => {
    const entry = { prompt: "Ocean", references: ["a", "b"] };
    const globalRefs = {
      a: "https://img.example.com/1.jpg",
      b: "https://img.example.com/2.jpg",
    };
    const result = _buildItem(entry, globalRefs, 0);
    expect(result).not.toBeNull();
    expect(result.images).toEqual([
      "https://img.example.com/1.jpg",
      "https://img.example.com/2.jpg",
    ]);
  });

  // P-REF-02: references is plain object → Object.values() in insertion order
  it("P-REF-02: references plain object yields Object.values() in insertion order", () => {
    const entry = {
      prompt: "Forest",
      references: {
        hero: "https://img.example.com/hero.jpg",
        bg: "https://img.example.com/bg.jpg",
      },
    };
    const result = _buildItem(entry, {}, 0);
    expect(result).not.toBeNull();
    expect(result.images).toEqual([
      "https://img.example.com/hero.jpg",
      "https://img.example.com/bg.jpg",
    ]);
  });

  // P-REF-03: images array is passed through unchanged
  it("P-REF-03: images array is passed through unchanged when no references field", () => {
    const entry = {
      prompt: "Sunset",
      images: ["https://cdn.example.com/a.jpg", "https://cdn.example.com/b.jpg"],
    };
    const result = _buildItem(entry, {}, 0);
    expect(result).not.toBeNull();
    expect(result.images).toEqual([
      "https://cdn.example.com/a.jpg",
      "https://cdn.example.com/b.jpg",
    ]);
  });

  // P-REF-08: entry with no usable prompt returns null
  it("P-REF-08: entry missing prompt/description/text returns null", () => {
    const entry = { name: "Shot A", images: ["https://cdn.example.com/img.jpg"] };
    const result = _buildItem(entry, {}, 0);
    expect(result).toBeNull();
  });

  // P-REF-09: no references or images → no images key on result
  it("P-REF-09: entry with no references or images produces item with no images key", () => {
    const entry = { name: "Shot B", prompt: "Drone flyover" };
    const result = _buildItem(entry, {}, 0);
    expect(result).not.toBeNull();
    expect("images" in result).toBe(false);
  });

  // P-REF-10: _inlineRefs overrides globalRefs for key-list lookup
  it("P-REF-10: _inlineRefs shadows globalRefs for the same key", () => {
    const entry = {
      prompt: "Timelapse",
      references: ["key"],
      _inlineRefs: { key: "https://inline.example.com/img.jpg" },
    };
    const globalRefs = { key: "https://global.example.com/img.jpg" };
    const result = _buildItem(entry, globalRefs, 0);
    expect(result).not.toBeNull();
    // _inlineRefs takes precedence over globalRefs
    expect(result.images).toEqual(["https://inline.example.com/img.jpg"]);
  });
});
