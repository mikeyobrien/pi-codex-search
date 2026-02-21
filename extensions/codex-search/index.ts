import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CODEX_RESULT_SCHEMA,
  buildCodexPrompt,
  coerceStructuredResult,
  createProgressCounters,
  formatProgressStatus,
  normalizeAsOfPeriod,
  normalizeSources,
  parseCodexJsonlEvents,
  parseJsonObject,
  updateProgressCountersFromEvent
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

const DEFAULT_TIMEOUT_SEC = 1800;
const MAX_TIMEOUT_SEC = 7200;
const DEFAULT_MAX_SOURCES = 8;
const PROGRESS_HEARTBEAT_MS = 5000;
const PROGRESS_MIN_INTERVAL_MS = 350;

async function runCodexSearch(
  params: RunParams,
  options?: {
    onUpdate?: (text: string) => void;
    signal?: AbortSignal;
  }
): Promise<RunResult> {
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
  const timeoutSec = Math.max(30, Math.min(params.timeout_sec ?? DEFAULT_TIMEOUT_SEC, MAX_TIMEOUT_SEC));
  const failOnCommandEvent = params.fail_on_command_event !== false;
  const startedAt = Date.now();
  const progress = createProgressCounters();

  const emit = options?.onUpdate;
  let lastProgressEmitAt = 0;
  const emitProgress = (force = false) => {
    if (!emit) return;
    const now = Date.now();
    if (!force && now - lastProgressEmitAt < PROGRESS_MIN_INTERVAL_MS) return;
    lastProgressEmitAt = now;
    emit(formatProgressStatus(progress, startedAt));
  };

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

    emitProgress(true);

    const child = spawn("codex", args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env
    });

    let stdout = "";
    let stderr = "";
    let lineBuffer = "";
    let timedOut = false;
    let aborted = false;

    const readStdoutLine = (line: string) => {
      if (!line.trim()) return;
      let event: unknown;
      try {
        event = JSON.parse(line);
      } catch {
        return;
      }

      const update = updateProgressCountersFromEvent(event, progress);
      if (update.changed) emitProgress();
    };

    child.stdout.on("data", (chunk: Buffer | string) => {
      const text = String(chunk);
      stdout += text;
      lineBuffer += text;

      let index = lineBuffer.indexOf("\n");
      while (index !== -1) {
        const line = lineBuffer.slice(0, index);
        lineBuffer = lineBuffer.slice(index + 1);
        readStdoutLine(line);
        index = lineBuffer.indexOf("\n");
      }
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += String(chunk);
    });

    const progressTimer = setInterval(() => {
      emitProgress(true);
    }, PROGRESS_HEARTBEAT_MS);

    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      progress.lastAction = `timeout after ${timeoutSec}s`;
      emitProgress(true);
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 1500).unref();
    }, timeoutSec * 1000);

    const abortListener = () => {
      aborted = true;
      progress.lastAction = "aborted";
      emitProgress(true);
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 1500).unref();
    };

    if (options?.signal) {
      if (options.signal.aborted) abortListener();
      else options.signal.addEventListener("abort", abortListener, { once: true });
    }

    const exitCode = await new Promise<number>((resolve, reject) => {
      child.once("error", (error) => {
        reject(error);
      });
      child.once("close", (code) => {
        resolve(code ?? -1);
      });
    }).finally(() => {
      clearInterval(progressTimer);
      clearTimeout(timeoutTimer);
      if (options?.signal) options.signal.removeEventListener("abort", abortListener);
    });

    if (lineBuffer.trim()) readStdoutLine(lineBuffer);

    const telemetry = parseCodexJsonlEvents(stdout);
    progress.lastAction = telemetry.usage ? "finalized" : progress.lastAction;
    emitProgress(true);

    let finalText = "";
    try {
      finalText = await readFile(outputPath, "utf8");
    } catch {
      finalText = "";
    }

    if (exitCode !== 0) {
      const reason = timedOut ? "timeout" : aborted ? "aborted" : "non_zero_exit";
      return {
        ok: false,
        text: `codex_search error: codex exited with code ${exitCode}`,
        details: {
          error: true,
          reason,
          exitCode,
          stderr,
          stdoutTail: stdout.slice(-4000),
          telemetry,
          progress: {
            elapsedSeconds: Math.max(0, Math.floor((Date.now() - startedAt) / 1000)),
            searches: progress.searches,
            pagesOpened: progress.pagesOpened
          }
        }
      };
    }

    const parsed = parseJsonObject(finalText);
    const structured = coerceStructuredResult(parsed);

    if (!structured) {
      const noFinalOutput = !finalText.trim();
      const likelyTimeout = noFinalOutput && !telemetry.usage;
      return {
        ok: false,
        text: noFinalOutput
          ? "codex_search error: no final structured output returned"
          : "codex_search error: failed to parse structured output",
        details: {
          error: true,
          reason: noFinalOutput ? "no_final_output" : "invalid_structured_output",
          hint: likelyTimeout
            ? "Codex produced search events but no final output. This is commonly a timeout. Retry with a larger timeout_sec."
            : undefined,
          rawOutput: finalText.slice(0, 4000),
          telemetry,
          progress: {
            elapsedSeconds: Math.max(0, Math.floor((Date.now() - startedAt) / 1000)),
            searches: progress.searches,
            pagesOpened: progress.pagesOpened
          }
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
          policyWarnings,
          progress: {
            elapsedSeconds: Math.max(0, Math.floor((Date.now() - startedAt) / 1000)),
            searches: progress.searches,
            pagesOpened: progress.pagesOpened
          }
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
      ...(sourceLines.length ? sourceLines : ["(none)"]),
      "",
      "Progress:",
      `- elapsed: ${Math.max(0, Math.floor((Date.now() - startedAt) / 1000))}s`,
      `- searches: ${progress.searches}`,
      `- pages opened: ${progress.pagesOpened}`
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
        policyWarnings,
        progress: {
          elapsedSeconds: Math.max(0, Math.floor((Date.now() - startedAt) / 1000)),
          searches: progress.searches,
          pagesOpened: progress.pagesOpened
        }
      }
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      text: `codex_search error: ${message}`,
      details: {
        error: true,
        reason: "spawn_failure",
        message,
        progress: {
          elapsedSeconds: Math.max(0, Math.floor((Date.now() - startedAt) / 1000)),
          searches: progress.searches,
          pagesOpened: progress.pagesOpened
        }
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
      timeout_sec: Type.Optional(Type.Number({ description: "Timeout in seconds (default: 1800, max: 7200)" })),
      max_sources: Type.Optional(Type.Number({ description: "Maximum number of source URLs to return (default: 8)" })),
      fail_on_command_event: Type.Optional(
        Type.Boolean({ description: "If true, fail when Codex JSONL shows command-like events (default: true)" })
      )
    }),
    async execute(_toolCallId, params, signal, onUpdate) {
      const result = await runCodexSearch(params, {
        signal,
        onUpdate: (text) => {
          onUpdate?.({ content: [{ type: "text", text }] });
        }
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
      const result = await runCodexSearch({ question });

      if (!result.ok) {
        ctx.ui.notify(result.text, "error");
        return;
      }

      ctx.ui.notify("Codex search complete", "success");
      ctx.ui.setEditorText(result.text);
    }
  });
}
