import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CODEX_RESULT_SCHEMA,
  buildCodexPrompt,
  coerceStructuredResult,
  normalizeSources,
  parseCodexJsonlEvents,
  parseJsonObject,
  normalizeAsOfPeriod
} from "../../lib/codex-runner.mjs";

type RunParams = {
  question: string;
  as_of_period?: string;
  as_of_year?: number;
  model?: string;
  timeout_sec?: number;
  max_sources?: number;
  fail_on_command_event?: boolean;
};

type RunResult = {
  ok: boolean;
  text: string;
  details: Record<string, unknown>;
};

const DEFAULT_TIMEOUT_SEC = 120;
const DEFAULT_MAX_SOURCES = 8;

async function runCodexSearch(pi: ExtensionAPI, params: RunParams, onUpdate?: (text: string) => void): Promise<RunResult> {
  const question = params.question.trim();
  if (!question) {
    return {
      ok: false,
      text: "codex_search error: question is required",
      details: { error: true, reason: "missing_question" }
    };
  }

  const asOfYear = Number.isFinite(params.as_of_year) ? Number(params.as_of_year) : new Date().getUTCFullYear();
  const asOfPeriod = normalizeAsOfPeriod(params.as_of_period);
  const maxSources = Math.max(1, Math.min(params.max_sources ?? DEFAULT_MAX_SOURCES, 20));
  const timeoutSec = Math.max(15, Math.min(params.timeout_sec ?? DEFAULT_TIMEOUT_SEC, 600));
  const failOnCommandEvent = params.fail_on_command_event !== false;

  const prompt = buildCodexPrompt({
    question,
    asOfPeriod,
    asOfYear
  });

  const tempDir = await mkdtemp(join(tmpdir(), "pi-codex-search-"));
  const schemaPath = join(tempDir, "schema.json");
  const outputPath = join(tempDir, "output.json");

  try {
    await writeFile(schemaPath, JSON.stringify(CODEX_RESULT_SCHEMA, null, 2), "utf8");

    const args = [
      "--search",
      "exec",
      "--ephemeral",
      "--skip-git-repo-check",
      "--sandbox",
      "read-only",
      "--json",
      "--output-schema",
      schemaPath,
      "-o",
      outputPath
    ];

    if (params.model?.trim()) {
      args.push("--model", params.model.trim());
    }

    args.push(prompt);

    onUpdate?.("Running Codex web search...");

    const result = await pi.exec("codex", args, {
      timeout: timeoutSec * 1000
    });

    const stdout = result.stdout || "";
    const stderr = result.stderr || "";
    const telemetry = parseCodexJsonlEvents(stdout);

    let finalText = "";
    try {
      finalText = await readFile(outputPath, "utf8");
    } catch {
      finalText = "";
    }

    if (result.code !== 0) {
      return {
        ok: false,
        text: `codex_search error: codex exited with code ${result.code}`,
        details: {
          error: true,
          exitCode: result.code,
          stderr,
          stdoutTail: stdout.slice(-4000),
          telemetry
        }
      };
    }

    const parsed = parseJsonObject(finalText);
    const structured = coerceStructuredResult(parsed);

    if (!structured) {
      return {
        ok: false,
        text: "codex_search error: failed to parse structured output",
        details: {
          error: true,
          reason: "invalid_structured_output",
          rawOutput: finalText.slice(0, 4000),
          telemetry
        }
      };
    }

    structured.sources = normalizeSources(structured.sources, maxSources);

    const policyWarnings: string[] = [];
    if (telemetry.commandEvents.length > 0) {
      policyWarnings.push(`Detected ${telemetry.commandEvents.length} command-like event(s) in Codex JSONL trace.`);
    }

    if (failOnCommandEvent && telemetry.commandEvents.length > 0) {
      return {
        ok: false,
        text: "codex_search policy error: Codex emitted command-like events",
        details: {
          error: true,
          reason: "command_events_detected",
          structured,
          telemetry,
          policyWarnings
        }
      };
    }

    const sourceLines = structured.sources.map((source, i) => `${i + 1}. ${source}`);
    const content = [
      `${structured.answer}`,
      "",
      `As of: ${structured.as_of}`,
      `Confidence: ${structured.confidence}`,
      "",
      "Sources:",
      ...(sourceLines.length ? sourceLines : ["(none)"])
    ];

    if (structured.notes) {
      content.push("", `Notes: ${structured.notes}`);
    }

    if (policyWarnings.length) {
      content.push("", `Warnings: ${policyWarnings.join(" ")}`);
    }

    return {
      ok: true,
      text: content.join("\n"),
      details: {
        query: question,
        as_of_period: asOfPeriod,
        as_of_year: asOfYear,
        model: params.model || null,
        structured,
        telemetry,
        policyWarnings
      }
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "codex_search",
    label: "Codex Search",
    description:
      "Run Codex web search in read-only mode with strict JSON schema output. Returns answer + source URLs + search telemetry.",
    parameters: Type.Object({
      question: Type.String({ description: "Question to research" }),
      as_of_period: Type.Optional(Type.String({ description: "Time period: early|mid|late (default: early)" })),
      as_of_year: Type.Optional(Type.Number({ description: "Reference year for recency framing (default: current UTC year)" })),
      model: Type.Optional(Type.String({ description: "Optional Codex model override" })),
      timeout_sec: Type.Optional(Type.Number({ description: "Timeout in seconds (default: 120, max: 600)" })),
      max_sources: Type.Optional(Type.Number({ description: "Maximum number of source URLs to return (default: 8)" })),
      fail_on_command_event: Type.Optional(
        Type.Boolean({ description: "If true, fail when Codex JSONL shows command-like events (default: true)" })
      )
    }),
    async execute(_toolCallId, params, _signal, onUpdate) {
      const result = await runCodexSearch(pi, params, (text) => {
        onUpdate?.({ content: [{ type: "text", text }] });
      });

      return {
        content: [{ type: "text", text: result.text }],
        details: result.details
      };
    }
  });

  pi.registerCommand("codex-search", {
    description: "Run Codex-backed web search (usage: /codex-search <question>)",
    handler: async (args, ctx) => {
      const question = args?.trim();
      if (!question) {
        ctx.ui.notify("Usage: /codex-search <question>", "error");
        return;
      }

      ctx.ui.notify("Running Codex search...", "info");
      const result = await runCodexSearch(pi, { question });

      if (!result.ok) {
        ctx.ui.notify(result.text, "error");
        return;
      }

      ctx.ui.notify("Codex search complete", "success");
      ctx.ui.setEditorText(result.text);
    }
  });
}
