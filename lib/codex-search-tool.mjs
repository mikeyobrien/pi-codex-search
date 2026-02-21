import { normalizeQuestions, resolveParallelism } from "./codex-runner.mjs";
import { runSingleCodexSearch } from "./codex-search-single.mjs";

const MAX_PARALLEL_SEARCHES = 5;
const PROGRESS_HEARTBEAT_MS = 5000;
const PROGRESS_MIN_INTERVAL_MS = 350;
const MAX_QUESTION_PREVIEW = 64;

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

function truncateText(value, max = MAX_QUESTION_PREVIEW) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return "";
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function toNonNegativeInt(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return undefined;
  return Math.max(0, Math.floor(numeric));
}

function parseNestedProgressUpdate(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) return null;
  if (!lines.some((line) => /^Running Codex web search/i.test(line))) return null;

  const elapsedLine = lines.find((line) => /^elapsed:/i.test(line));
  const searchesLine = lines.find((line) => /^searches:/i.test(line));
  const pagesLine = lines.find((line) => /^pages opened:/i.test(line));
  const actionLine = lines.find((line) => /^last action:/i.test(line));

  const elapsedSeconds = toNonNegativeInt(elapsedLine?.match(/(\d+)/)?.[1]);
  const searches = toNonNegativeInt(searchesLine?.match(/(\d+)/)?.[1]);
  const pagesOpened = toNonNegativeInt(pagesLine?.match(/(\d+)/)?.[1]);
  const lastAction = actionLine ? actionLine.replace(/^last action:\s*/i, "").trim() : undefined;

  return {
    elapsedSeconds,
    searches,
    pagesOpened,
    lastAction
  };
}

function extractProgressFromResultDetails(details) {
  if (!details || typeof details !== "object") return {};
  const progress = details.progress;
  if (!progress || typeof progress !== "object") return {};

  return {
    elapsedSeconds: toNonNegativeInt(progress.elapsedSeconds),
    searches: toNonNegativeInt(progress.searches),
    pagesOpened: toNonNegativeInt(progress.pagesOpened)
  };
}

function extractFailureReason(details) {
  if (!details || typeof details !== "object") return "unknown";
  if (typeof details.reason === "string" && details.reason.trim()) return details.reason.trim();
  return "unknown";
}

function createRunState(question, index) {
  return {
    index,
    question,
    status: "pending",
    elapsedSeconds: 0,
    searches: 0,
    pagesOpened: 0,
    lastAction: "queued",
    startedAt: 0,
    updatedAt: Date.now()
  };
}

function formatRunStateLine(state, total) {
  const label = `[${state.index + 1}/${total}] ${truncateText(state.question)}`;
  const stats = `s=${state.searches} p=${state.pagesOpened}`;

  if (state.status === "pending") {
    return `${label} | pending`;
  }

  if (state.status === "running") {
    return `${label} | running | ${state.elapsedSeconds}s | ${stats} | ${state.lastAction}`;
  }

  if (state.status === "ok") {
    return `${label} | ok | ${state.elapsedSeconds}s | ${stats}`;
  }

  return `${label} | failed | ${state.elapsedSeconds}s | ${stats} | ${state.lastAction}`;
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
  const runStates = questions.map((question, index) => createRunState(question, index));

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
        `parallelism: ${parallelism}`,
        "",
        "runs:",
        ...runStates.map((state) => formatRunStateLine(state, questions.length))
      ].join("\n")
    );
  };

  const applyNestedUpdate = (index, text) => {
    const state = runStates[index];
    if (!state) return;

    if (typeof text === "string" && /^Codex prompt:/i.test(text.trim())) {
      state.lastAction = "prompt prepared";
      state.updatedAt = Date.now();
      emitStatus(true);
      return;
    }

    const parsed = parseNestedProgressUpdate(text);
    if (!parsed) return;

    if (parsed.elapsedSeconds !== undefined) state.elapsedSeconds = parsed.elapsedSeconds;
    if (parsed.searches !== undefined) state.searches = parsed.searches;
    if (parsed.pagesOpened !== undefined) state.pagesOpened = parsed.pagesOpened;
    if (parsed.lastAction) state.lastAction = parsed.lastAction;
    state.updatedAt = Date.now();

    emitStatus(true);
  };

  const worker = async () => {
    while (true) {
      if (options.signal?.aborted) return;

      const index = nextIndex;
      nextIndex += 1;
      if (index >= questions.length) return;

      const question = questions[index];
      const state = runStates[index];

      running += 1;
      state.status = "running";
      state.startedAt = Date.now();
      state.updatedAt = state.startedAt;
      state.lastAction = "starting";

      emit?.(`Starting query ${index + 1}/${questions.length}: ${question}`);
      emitStatus(true);

      let result;
      try {
        result = await runSingle(toSingleSearchParams(question, params), {
          signal: options.signal,
          onUpdate: (text) => {
            applyNestedUpdate(index, text);
          }
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

      const resultProgress = extractProgressFromResultDetails(result.details);
      if (resultProgress.elapsedSeconds !== undefined) state.elapsedSeconds = resultProgress.elapsedSeconds;
      if (resultProgress.searches !== undefined) state.searches = resultProgress.searches;
      if (resultProgress.pagesOpened !== undefined) state.pagesOpened = resultProgress.pagesOpened;

      state.status = result.ok ? "ok" : "failed";
      state.updatedAt = Date.now();
      state.lastAction = result.ok ? "completed" : `error: ${extractFailureReason(result.details)}`;

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

    const state = runStates[i];
    state.status = "failed";
    state.lastAction = "error: not_started_due_abort";
    state.updatedAt = Date.now();

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
    runStates: runStates.map((state) => ({
      index: state.index,
      question: state.question,
      status: state.status,
      elapsedSeconds: state.elapsedSeconds,
      searches: state.searches,
      pagesOpened: state.pagesOpened,
      lastAction: state.lastAction,
      startedAt: state.startedAt || null,
      updatedAt: state.updatedAt || null
    })),
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
