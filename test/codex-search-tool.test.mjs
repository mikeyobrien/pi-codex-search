import test from "node:test";
import assert from "node:assert/strict";
import { runCodexSearch } from "../lib/codex-search-tool.mjs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function okResult(question) {
  return {
    ok: true,
    text: `ok: ${question}`,
    details: { query: question }
  };
}

function errorResult(question, reason = "test_failure") {
  return {
    ok: false,
    text: `error: ${question}`,
    details: {
      error: true,
      reason,
      query: question
    }
  };
}

test("runCodexSearch rejects empty question lists", async () => {
  const result = await runCodexSearch({ questions: ["", "   "] });

  assert.equal(result.ok, false);
  assert.equal(result.details.reason, "missing_questions");
});

test("runCodexSearch single question delegates to runner", async () => {
  let seenParams = null;
  let seenSignal = null;
  let seenOnUpdate = null;

  const controller = new AbortController();
  const onUpdate = () => {};

  const result = await runCodexSearch(
    {
      questions: ["what is npm latest"],
      as_of_period: "mid",
      as_of_year: 2026,
      timeout_sec: 123,
      max_sources: 4,
      fail_on_command_event: false
    },
    {
      signal: controller.signal,
      onUpdate,
      runSingle: async (params, options) => {
        seenParams = params;
        seenSignal = options.signal;
        seenOnUpdate = options.onUpdate;
        return okResult(params.question);
      }
    }
  );

  assert.equal(result.ok, true);
  assert.equal(result.text, "ok: what is npm latest");
  assert.deepEqual(seenParams, {
    question: "what is npm latest",
    as_of_period: "mid",
    as_of_year: 2026,
    model: undefined,
    timeout_sec: 123,
    max_sources: 4,
    fail_on_command_event: false
  });
  assert.equal(seenSignal, controller.signal);
  assert.equal(seenOnUpdate, onUpdate);
});

test("runCodexSearch runs multi-question batches in parallel and preserves input order", async () => {
  const completionOrder = [];
  const delays = {
    q1: 40,
    q2: 5,
    q3: 10,
    q4: 1
  };

  let inFlight = 0;
  let maxInFlight = 0;

  const result = await runCodexSearch(
    {
      questions: ["q1", "q2", "q3", "q4"],
      parallelism: 2
    },
    {
      runSingle: async (params) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await sleep(delays[params.question]);
        completionOrder.push(params.question);
        inFlight -= 1;
        return okResult(params.question);
      }
    }
  );

  assert.equal(result.ok, true);
  assert.equal(result.details.summary.parallelism, 2);
  assert.equal(maxInFlight, 2);
  assert.notDeepEqual(completionOrder, ["q1", "q2", "q3", "q4"]);
  assert.deepEqual(
    result.details.results.map((entry) => entry.question),
    ["q1", "q2", "q3", "q4"]
  );
});

test("runCodexSearch caps parallelism at 5", async () => {
  const questions = Array.from({ length: 8 }, (_, i) => `q${i + 1}`);
  let inFlight = 0;
  let maxInFlight = 0;

  const result = await runCodexSearch(
    {
      questions,
      parallelism: 99
    },
    {
      runSingle: async (params) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await sleep(5);
        inFlight -= 1;
        return okResult(params.question);
      }
    }
  );

  assert.equal(result.ok, true);
  assert.equal(result.details.summary.parallelism, 5);
  assert.ok(maxInFlight <= 5);
});

test("runCodexSearch emits batch and per-run progress updates", async () => {
  const updates = [];

  await runCodexSearch(
    {
      questions: ["q1", "q2"],
      parallelism: 1
    },
    {
      onUpdate: (text) => updates.push(text),
      runSingle: async (params, options) => {
        options.onUpdate?.([
          "Running Codex web search...",
          "elapsed: 3s",
          "searches: 2",
          "pages opened: 1",
          "last action: search: test query"
        ].join("\n"));
        await sleep(1);
        return okResult(params.question);
      }
    }
  );

  assert.ok(updates.some((text) => text.includes("Running parallel Codex web searches...")));
  assert.ok(updates.some((text) => text.includes("Starting query 1/2: q1")));
  assert.ok(updates.some((text) => text.includes("Finished query 2/2: ok")));
  assert.ok(updates.some((text) => text.includes("runs:")));
  assert.ok(updates.some((text) => text.includes("[1/2] q1 | running | 3s | s=2 p=1 | search: test query")));
});

test("runCodexSearch reports partial failures", async () => {
  const result = await runCodexSearch(
    {
      questions: ["ok-1", "bad", "ok-2"]
    },
    {
      runSingle: async (params, options) => {
        options.onUpdate?.([
          "Running Codex web search...",
          "elapsed: 4s",
          "searches: 3",
          "pages opened: 2",
          "last action: open: https://example.com"
        ].join("\n"));

        if (params.question === "bad") return errorResult(params.question, "bad_query");
        return okResult(params.question);
      }
    }
  );

  assert.equal(result.ok, true);
  assert.equal(result.details.partialFailure, true);
  assert.equal(result.details.summary.total, 3);
  assert.equal(result.details.summary.succeeded, 2);
  assert.equal(result.details.summary.failed, 1);

  const badRun = result.details.runStates.find((entry) => entry.question === "bad");
  assert.equal(badRun.status, "failed");
  assert.equal(badRun.searches, 3);
  assert.equal(badRun.pagesOpened, 2);
  assert.match(badRun.lastAction, /bad_query/i);
});

test("runCodexSearch returns all_failed when every question fails", async () => {
  const result = await runCodexSearch(
    {
      questions: ["bad-1", "bad-2"]
    },
    {
      runSingle: async (params) => errorResult(params.question)
    }
  );

  assert.equal(result.ok, false);
  assert.equal(result.details.reason, "all_failed");
  assert.equal(result.details.summary.succeeded, 0);
  assert.equal(result.details.summary.failed, 2);
});

test("runCodexSearch converts runner exceptions into failed entries", async () => {
  const result = await runCodexSearch(
    {
      questions: ["ok", "boom"]
    },
    {
      runSingle: async (params) => {
        if (params.question === "boom") throw new Error("runner exploded");
        return okResult(params.question);
      }
    }
  );

  assert.equal(result.ok, true);
  const boom = result.details.results.find((entry) => entry.question === "boom");
  assert.equal(boom.ok, false);
  assert.equal(boom.details.reason, "runner_exception");
  assert.match(boom.text, /runner exploded/i);
});

test("runCodexSearch handles pre-aborted signal without starting queries", async () => {
  const controller = new AbortController();
  controller.abort();

  let calls = 0;
  const result = await runCodexSearch(
    {
      questions: ["q1", "q2"]
    },
    {
      signal: controller.signal,
      runSingle: async () => {
        calls += 1;
        return okResult("should-not-run");
      }
    }
  );

  assert.equal(calls, 0);
  assert.equal(result.ok, false);
  assert.equal(result.details.reason, "all_failed");
  for (const entry of result.details.results) {
    assert.equal(entry.ok, false);
    assert.equal(entry.details.reason, "not_started_due_abort");
  }
});

test("runCodexSearch marks remaining work as not started when aborted mid-batch", async () => {
  const controller = new AbortController();
  let started = 0;

  const resultPromise = runCodexSearch(
    {
      questions: ["q1", "q2", "q3", "q4"],
      parallelism: 2
    },
    {
      signal: controller.signal,
      runSingle: async (params) => {
        started += 1;
        await sleep(20);
        return okResult(params.question);
      }
    }
  );

  await sleep(5);
  controller.abort();

  const result = await resultPromise;
  assert.equal(started, 2);
  assert.equal(result.ok, true);
  assert.equal(result.details.summary.succeeded, 2);
  assert.equal(result.details.summary.failed, 2);

  const notStarted = result.details.results.filter((entry) => entry.details.reason === "not_started_due_abort");
  assert.equal(notStarted.length, 2);
  assert.deepEqual(
    notStarted.map((entry) => entry.question),
    ["q3", "q4"]
  );
});

test("runCodexSearch ignores blank entries and only runs normalized questions", async () => {
  const seen = [];
  const result = await runCodexSearch(
    {
      questions: [" q1 ", "", "   ", "q2"]
    },
    {
      runSingle: async (params) => {
        seen.push(params.question);
        return okResult(params.question);
      }
    }
  );

  assert.equal(result.ok, true);
  assert.deepEqual(seen, ["q1", "q2"]);
  assert.equal(result.details.summary.total, 2);
});
