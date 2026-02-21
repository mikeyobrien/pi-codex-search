import { normalizeQuestions, resolveParallelism } from "./codex-runner.mjs";
import { runSingleCodexSearch } from "./codex-search-single.mjs";

const MAX_PARALLEL_SEARCHES = 5;
const PROGRESS_HEARTBEAT_MS = 5000;
const PROGRESS_MIN_INTERVAL_MS = 350;

function toSingleSearchParams(question, params) {
  return {
    question,
    as_of_period: params.as_of_period,
    as_of_year: params.as_of_year,
    model: params.model,
    timeout_sec: params.timeout_sec,
    max_sources: params.max_sources,
    fail_on_command_event: params.fail_on_command_event
  };
}

function runnerExceptionResult(question, error) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    ok: false,
    text: `codex_search error: ${message}`,
    details: {
      error: true,
      reason: "runner_exception",
      query: question,
      message
    }
  };
}

export async function runCodexSearch(params, options = {}) {
  const questions = normalizeQuestions(params.questions);
  if (!questions.length) {
    return {
      ok: false,
      text: "codex_search error: questions must contain at least one non-empty entry",
      details: { error: true, reason: "missing_questions" }
    };
  }

  const runSingle = typeof options.runSingle === "function" ? options.runSingle : runSingleCodexSearch;

  if (questions.length === 1) {
    try {
      return await runSingle(toSingleSearchParams(questions[0], params), {
        signal: options.signal,
        onUpdate: options.onUpdate
      });
    } catch (error) {
      return runnerExceptionResult(questions[0], error);
    }
  }

  const parallelism = resolveParallelism(params.parallelism, questions.length, MAX_PARALLEL_SEARCHES);
  const startedAt = Date.now();
  const emit = options.onUpdate;

  const entries = new Array(questions.length);
  let nextIndex = 0;
  let running = 0;
  let completed = 0;
  let failed = 0;
  let lastProgressEmitAt = 0;

  const emitStatus = (force = false) => {
    if (!emit) return;
    const now = Date.now();
    if (!force && now - lastProgressEmitAt < PROGRESS_MIN_INTERVAL_MS) return;
    lastProgressEmitAt = now;

    emit(
      [
        "Running parallel Codex web searches...",
        `elapsed: ${Math.max(0, Math.floor((Date.now() - startedAt) / 1000))}s`,
        `total: ${questions.length}`,
        `completed: ${completed}`,
        `running: ${running}`,
        `failed: ${failed}`,
        `parallelism: ${parallelism}`
      ].join("\n")
    );
  };

  const worker = async () => {
    while (true) {
      if (options.signal?.aborted) return;

      const index = nextIndex;
      nextIndex += 1;
      if (index >= questions.length) return;

      const question = questions[index];
      running += 1;
      emit?.(`Starting query ${index + 1}/${questions.length}: ${question}`);
      emitStatus();

      let result;
      try {
        result = await runSingle(toSingleSearchParams(question, params), {
          signal: options.signal
        });
      } catch (error) {
        result = runnerExceptionResult(question, error);
      }

      entries[index] = {
        question,
        ok: result.ok,
        text: result.text,
        details: result.details
      };

      running -= 1;
      completed += 1;
      if (!result.ok) failed += 1;

      emit?.(`Finished query ${index + 1}/${questions.length}: ${result.ok ? "ok" : "failed"}`);
      emitStatus(true);
    }
  };

  emitStatus(true);
  const heartbeat = setInterval(() => {
    emitStatus(true);
  }, PROGRESS_HEARTBEAT_MS);

  try {
    await Promise.all(Array.from({ length: parallelism }, () => worker()));
  } finally {
    clearInterval(heartbeat);
  }

  for (let i = 0; i < entries.length; i += 1) {
    if (entries[i]) continue;
    failed += 1;
    completed += 1;
    entries[i] = {
      question: questions[i],
      ok: false,
      text: "codex_search error: query was not started because the batch was aborted",
      details: {
        error: true,
        reason: "not_started_due_abort",
        query: questions[i]
      }
    };
  }

  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  const succeeded = questions.length - failed;

  const summary = {
    total: questions.length,
    succeeded,
    failed,
    parallelism,
    elapsedSeconds
  };

  const text = [
    "Codex batch search summary",
    `- total: ${summary.total}`,
    `- succeeded: ${summary.succeeded}`,
    `- failed: ${summary.failed}`,
    `- parallelism: ${summary.parallelism}`,
    `- elapsed: ${summary.elapsedSeconds}s`,
    ...entries.flatMap((entry, index) => [
      "",
      `--- Result ${index + 1}/${questions.length} ---`,
      `Question: ${entry.question}`,
      `Status: ${entry.ok ? "ok" : "error"}`,
      "",
      entry.text
    ])
  ].join("\n");

  const details = {
    summary,
    results: entries.map((entry) => ({
      question: entry.question,
      ok: entry.ok,
      text: entry.text,
      details: entry.details
    }))
  };

  if (succeeded === 0) {
    return {
      ok: false,
      text,
      details: {
        error: true,
        reason: "all_failed",
        ...details
      }
    };
  }

  return {
    ok: true,
    text,
    details: {
      ...details,
      partialFailure: failed > 0
    }
  };
}
