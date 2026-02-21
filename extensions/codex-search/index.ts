import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { runCodexSearch } from "../../lib/codex-search-tool.mjs";
import { normalizeQuestions } from "../../lib/codex-runner.mjs";

type CodexSearchParams = {
  questions: string[];
  as_of_period?: string;
  as_of_year?: number;
  model?: string;
  timeout_sec?: number;
  max_sources?: number;
  parallelism?: number;
  fail_on_command_event?: boolean;
};

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "codex_search",
    label: "Codex Search",
    description:
      "Run one or more Codex web searches in read-only mode with strict JSON schema output. Multiple questions run in parallel.",
    parameters: Type.Object({
      questions: Type.Array(Type.String({ minLength: 1 }), {
        minItems: 1,
        description:
          "Questions to research. A single question runs once; multiple questions run in parallel."
      }),
      as_of_period: Type.Optional(Type.String({ description: "Time period: early|mid|late (default: early)" })),
      as_of_year: Type.Optional(Type.Number({ description: "Reference year for recency framing (default: current UTC year)" })),
      model: Type.Optional(Type.String({ description: "Optional Codex model override" })),
      timeout_sec: Type.Optional(Type.Number({ description: "Timeout in seconds (default: 1800, max: 7200)" })),
      max_sources: Type.Optional(Type.Number({ description: "Maximum number of source URLs to return (default: 8)" })),
      parallelism: Type.Optional(Type.Number({ description: "Parallel workers for batch runs (default: auto, max: 5)" })),
      fail_on_command_event: Type.Optional(
        Type.Boolean({ description: "If true, fail when Codex JSONL shows command-like events (default: true)" })
      )
    }),
    async execute(_toolCallId, rawParams, signal, onUpdate) {
      const params = rawParams as CodexSearchParams;
      const result = await runCodexSearch(params, {
        signal,
        onUpdate: (text: string) => {
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
    description: "Run Codex-backed web search (usage: /codex-search <question> [|| <question2> ...])",
    handler: async (args, ctx) => {
      const questions = normalizeQuestions((args || "").split("||"));
      if (!questions.length) {
        ctx.ui.notify("Usage: /codex-search <question> [|| <question2> ...]", "error");
        return;
      }

      ctx.ui.notify(`Running ${questions.length} Codex search${questions.length === 1 ? "" : "es"}...`, "info");
      const result = await runCodexSearch({ questions });

      if (!result.ok) {
        ctx.ui.notify("Codex search failed", "error");
        ctx.ui.setEditorText(result.text);
        return;
      }

      ctx.ui.notify("Codex search complete", "success");
      ctx.ui.setEditorText(result.text);
    }
  });
}
