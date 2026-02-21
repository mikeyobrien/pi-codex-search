import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCodexPrompt,
  parseJsonObject,
  normalizeSources,
  parseCodexJsonlEvents,
  coerceStructuredResult,
  normalizeAsOfPeriod
} from "../lib/codex-runner.mjs";

test("buildCodexPrompt includes policy constraints and as_of framing", () => {
  const prompt = buildCodexPrompt({
    question: "What is the latest stable Node.js LTS version",
    asOfPeriod: "mid",
    asOfYear: 2026
  });

  assert.match(prompt, /latest stable Node\.js LTS version/i);
  assert.match(prompt, /as of mid 2026/i);
  assert.match(prompt, /Use the web search tool/i);
  assert.match(prompt, /Do not execute commands or modify files/i);
  assert.match(prompt, /Return JSON that matches the provided schema/i);
});

test("parseJsonObject parses plain and fenced JSON", () => {
  const plain = parseJsonObject('{"answer":"ok"}');
  const fenced = parseJsonObject("```json\n{\n  \"answer\": \"ok\"\n}\n```");
  const invalid = parseJsonObject("not json");

  assert.deepEqual(plain, { answer: "ok" });
  assert.deepEqual(fenced, { answer: "ok" });
  assert.equal(invalid, null);
});

test("normalizeSources deduplicates and filters invalid URLs", () => {
  const normalized = normalizeSources([
    "https://example.com/a",
    "https://example.com/a",
    "http://example.org/b",
    "ftp://example.net/c",
    "not-a-url"
  ]);

  assert.deepEqual(normalized, ["https://example.com/a", "http://example.org/b"]);
});

test("parseCodexJsonlEvents extracts web search trace, usage and command events", () => {
  const jsonl = [
    JSON.stringify({ type: "thread.started", thread_id: "1" }),
    JSON.stringify({
      type: "item.completed",
      item: {
        type: "web_search",
        query: "node latest lts",
        action: { type: "search", queries: ["node latest lts"] }
      }
    }),
    JSON.stringify({
      type: "item.completed",
      item: {
        type: "web_search",
        query: "https://nodejs.org/en/about/previous-releases",
        action: { type: "open_page", url: "https://nodejs.org/en/about/previous-releases" }
      }
    }),
    JSON.stringify({
      type: "item.completed",
      item: {
        type: "exec",
        command: "ls"
      }
    }),
    JSON.stringify({ type: "turn.completed", usage: { input_tokens: 100, output_tokens: 20 } })
  ].join("\n");

  const parsed = parseCodexJsonlEvents(jsonl);
  assert.equal(parsed.searchTrace.length, 2);
  assert.equal(parsed.searchTrace[0].actionType, "search");
  assert.equal(parsed.searchTrace[1].actionType, "open_page");
  assert.equal(parsed.commandEvents.length, 1);
  assert.deepEqual(parsed.usage, { input_tokens: 100, output_tokens: 20 });
});

test("coerceStructuredResult validates required fields and normalizes sources", () => {
  const valid = coerceStructuredResult({
    answer: "Node.js v24.13.1",
    as_of: "early 2026",
    confidence: 0.92,
    sources: ["https://nodejs.org/en/blog/release/v24.13.1", "https://nodejs.org/en/blog/release/v24.13.1"],
    notes: "official source"
  });

  const invalid = coerceStructuredResult({ answer: "missing fields" });

  assert.equal(valid?.answer, "Node.js v24.13.1");
  assert.equal(valid?.as_of, "early 2026");
  assert.equal(valid?.confidence, 0.92);
  assert.deepEqual(valid?.sources, ["https://nodejs.org/en/blog/release/v24.13.1"]);
  assert.equal(invalid, null);
});

test("normalizeAsOfPeriod falls back to early", () => {
  assert.equal(normalizeAsOfPeriod("late"), "late");
  assert.equal(normalizeAsOfPeriod("MID"), "mid");
  assert.equal(normalizeAsOfPeriod("nonsense"), "early");
});
