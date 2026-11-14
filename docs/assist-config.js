/* The AI assist's prompt configuration: what the model is asked to extract.
 * Shared by the page (app.js) and the extraction test (scripts/eval_assist.js),
 * so the test scores exactly the prompt visitors get. */
(function (g) {
  "use strict";
  var ASSIST_CONFIG = {
    title: "Check my methods section.",
    lede: "Paste the methods section or README of an eval (yours or a paper's). The model answers each checklist question with the sentence that supports it, or says the text does not state it. Unstated items are worth stating in your write-up.",
    placeholder: "e.g. We compare our agent with and without the planning module on 120 tasks from the benchmark, 3 runs per task each. Runs that time out are excluded. A GPT judge grades each transcript...",
    examples: [
      { label: "A typical methods paragraph", text: "We evaluate the baseline agent and the agent with the new retrieval tool on the same 120 tasks from our internal benchmark. Each configuration is run 3 times per task. The new tool variant is allowed up to 3 retries per task and we keep the best run. Runs that time out are excluded from the analysis. Outputs are graded by a GPT-4-class judge that sees the full transcript, including the system prompt. We report the success rate over all runs and test significance with a two-proportion z-test. The baseline currently solves about 41% of tasks. We ran the baseline first, then the variant the following week." },
      { label: "A careful one", text: "Both agents were run on the same 200 tasks, 5 attempts per task each, interleaved in random order on the same pinned model snapshot within a single day. The two system prompts are identical except for the tool description being tested. Failures, timeouts and unparseable outputs are scored as failures for both agents. A judge model graded anonymized transcripts with the condition labels removed. Our pre-registered primary metric is task success; significance is assessed with a paired t-test on per-task success rates. Baseline success is 55%; we consider a 5-point gain meaningful." }
    ],
    instructions: "The text describes an evaluation comparing two versions (A = baseline, B = new) of an AI agent, prompt or model on a set of tasks. Answer each item only from what the text states. Yes/no items: true for yes, false for no, null if the text does not say. 'sameCompute' is false if one version gets more attempts, retries, best-of-k, tokens or time than the other. 'sameFailureHandling' is false if crashes, timeouts or errors are excluded (dropping runs or tasks), because exclusion can differ by version; true only if failures are counted the same way for both (e.g. scored as failures). 'sameParseHandling' is false if unparseable outputs are treated differently between versions or simply dropped. 'taskLevelTest' is true if the significance test treats tasks as the unit (per-task rates, paired or clustered by task), false if it pools all runs as independent (e.g. a two-proportion test over runs). 'judgeBlind': 'blind' if a judge cannot see which version produced an output, 'unblind' if it can (e.g. it sees system prompts or condition names), 'none' if no judge is used. 'interleaved' is true if both versions ran at the same time / interleaved on the same model version, false if run at different times or model versions. 'promptsMatch' is true if the two prompts differ only in the thing being tested. 'metricsExamined' is the number of metrics looked at before picking what to report (1 if a single pre-registered primary metric). successRate and improvement are percentages.",
    fields: [
      { key: "tasks", label: "Tasks", type: "number" },
      { key: "attempts", label: "Attempts per task, per version", type: "number" },
      { key: "rate", label: "Current success rate (%)", type: "number" },
      { key: "gain", label: "Improvement worth detecting (points)", type: "number" },
      { key: "paired", label: "Same tasks for both versions", type: "boolean" },
      { key: "sameCompute", label: "Same attempts and compute", type: "boolean" },
      { key: "sameFailureHandling", label: "Crashes and timeouts kept, same for both", type: "boolean" },
      { key: "sameParseHandling", label: "Parse failures handled the same", type: "boolean" },
      { key: "taskLevelTest", label: "Test treats tasks as the unit", type: "boolean" },
      { key: "judgeBlind", label: "Judge (blind / unblind / none)", type: "text" },
      { key: "interleaved", label: "Versions interleaved on one model version", type: "boolean" },
      { key: "promptsMatch", label: "Prompts differ only in what is tested", type: "boolean" },
      { key: "metricsExamined", label: "Metrics examined before reporting", type: "number" }
    ]
  };
  if (typeof module !== "undefined" && module.exports) module.exports = ASSIST_CONFIG;
  g.ASSIST_CONFIG = ASSIST_CONFIG;
})(typeof window !== "undefined" ? window : globalThis);
