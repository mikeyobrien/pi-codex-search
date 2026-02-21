export const CODEX_RESULT_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  additionalProperties: false,
  required: ["answer", "as_of", "sources", "confidence", "notes"],
  properties: {
    answer: { type: "string", minLength: 1 },
    as_of: { type: "string", minLength: 1 },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    sources: {
      type: "array",
      items: { type: "string" },
      maxItems: 20
    },
    notes: { type: "string" }
  }
};

export function buildCodexPrompt({ question, asOfPeriod = "early", asOfYear = new Date().getUTCFullYear() }) {
  const period = normalizeAsOfPeriod(asOfPeriod);
  return [
    `${question}.`,
    "Use the web search tool.",
    `Search for the latest available information as of ${period} ${asOfYear}.`,
    "Do not execute commands or modify files.",
    "Return JSON that matches the provided schema.",
    "Include source URLs in the sources field."
  ].join(" ");
}

export function normalizeAsOfPeriod(value) {
  const period = String(value || "early").toLowerCase();
  if (period === "early" || period === "mid" || period === "late") return period;
  return "early";
}

export function parseJsonObject(text) {
  if (typeof text !== "string") return null;
  const trimmed = text.trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed);
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (!fenced) return null;
    try {
      return JSON.parse(fenced[1]);
    } catch {
      return null;
    }
  }
}

export function normalizeSources(rawSources, maxSources = 12) {
  if (!Array.isArray(rawSources)) return [];
  const seen = new Set();
  const out = [];

  for (const source of rawSources) {
    if (typeof source !== "string") continue;
    const value = source.trim();
    if (!value) continue;

    try {
      const parsed = new URL(value);
      if (!["http:", "https:"].includes(parsed.protocol)) continue;
      const normalized = parsed.toString();
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      out.push(normalized);
      if (out.length >= maxSources) break;
    } catch {
      continue;
    }
  }

  return out;
}

export function createProgressCounters() {
  return {
    searches: 0,
    pagesOpened: 0,
    lastAction: "starting"
  };
}

function shortValue(value, maxLen = 96) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.length <= maxLen ? trimmed : `${trimmed.slice(0, maxLen - 1)}…`;
}

export function updateProgressCountersFromEvent(event, counters) {
  if (!event || typeof event !== "object") {
    return { changed: false, lastAction: counters.lastAction };
  }

  if (event.type === "item.completed" && event.item?.type === "web_search") {
    const actionType = event.item?.action?.type || "unknown";
    const query = shortValue(event.item?.query || event.item?.action?.query || "");
    const url = shortValue(event.item?.action?.url || "");

    if (actionType === "search") {
      counters.searches += 1;
      counters.lastAction = query ? `search: ${query}` : "search";
      return { changed: true, lastAction: counters.lastAction };
    }

    if (actionType === "open_page") {
      counters.pagesOpened += 1;
      counters.lastAction = url ? `open: ${url}` : "open page";
      return { changed: true, lastAction: counters.lastAction };
    }

    counters.lastAction = actionType;
    return { changed: true, lastAction: counters.lastAction };
  }

  if (event.type === "turn.completed") {
    counters.lastAction = "finalizing";
    return { changed: true, lastAction: counters.lastAction };
  }

  if (event.type === "error") {
    counters.lastAction = "error event";
    return { changed: true, lastAction: counters.lastAction };
  }

  return { changed: false, lastAction: counters.lastAction };
}

export function formatProgressStatus(counters, startedAtMs = Date.now()) {
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000));
  return [
    "Running Codex web search...",
    `elapsed: ${elapsedSeconds}s`,
    `searches: ${counters.searches}`,
    `pages opened: ${counters.pagesOpened}`,
    `last action: ${counters.lastAction}`
  ].join("\n");
}

export function parseCodexJsonlEvents(stdout) {
  const lines = typeof stdout === "string" ? stdout.split(/\r?\n/) : [];
  const searchTrace = [];
  const errors = [];
  const commandEvents = [];
  let usage = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let event;
    try {
      event = JSON.parse(trimmed);
    } catch {
      continue;
    }

    if (event?.type === "turn.completed" && event?.usage) {
      usage = event.usage;
      continue;
    }

    if (event?.type === "error") {
      errors.push(event);
      continue;
    }

    const item = event?.item;
    if (!item || typeof item !== "object") continue;

    const itemType = typeof item.type === "string" ? item.type : "";
    if (itemType && /(exec|command|bash|shell)/i.test(itemType)) {
      commandEvents.push({ eventType: event.type, itemType, item });
    }

    if (event?.type !== "item.completed") continue;
    if (itemType !== "web_search") continue;

    const actionType = item?.action?.type || "unknown";
    const queries = Array.isArray(item?.action?.queries) ? item.action.queries : [];
    const url = typeof item?.action?.url === "string" ? item.action.url : undefined;
    const query = typeof item?.query === "string" ? item.query : "";

    searchTrace.push({ actionType, query, queries, url });
  }

  return { searchTrace, usage, errors, commandEvents };
}

export function coerceStructuredResult(value) {
  if (!value || typeof value !== "object") return null;
  const answer = typeof value.answer === "string" ? value.answer.trim() : "";
  const asOf = typeof value.as_of === "string" ? value.as_of.trim() : "";
  const confidence = typeof value.confidence === "number" ? value.confidence : null;
  const notes = typeof value.notes === "string" ? value.notes.trim() : undefined;
  const sources = normalizeSources(value.sources || []);

  if (!answer || !asOf || confidence === null) return null;

  return {
    answer,
    as_of: asOf,
    confidence,
    sources,
    notes
  };
}
