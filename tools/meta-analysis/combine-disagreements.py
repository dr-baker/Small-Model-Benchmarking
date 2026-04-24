#!/usr/bin/env python3
"""
Join deterministic grade + LLM-judge verdict for every run in
benchmark-results/ and emit two artifacts alongside this script:

  disagreements.json             one object per disagreeing run
  per-question-disagreements.csv counts per question, broken out by kind

Disagreement kinds:
  det_correct__judge_incorrect   deterministic passed but judge failed
  det_correct__judge_partial     deterministic passed but judge partial
  det_wrong__judge_correct       deterministic failed but judge passed
  det_wrong__judge_partial       deterministic failed but judge partial

Input source: benchmark-results/<execution>/aggregate-runs.jsonl
              benchmark/dataset/swiftui-docs-chatbot-benchmark.v1.json
              benchmark/rubric/rubric.v1.json
"""
import json
import os
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))


def load_rows():
    base = os.path.join(REPO, "benchmark-results")
    rows = []
    for d in sorted(os.listdir(base)):
        if d == "archive" or "smoke" in d:
            continue
        p = os.path.join(base, d, "aggregate-runs.jsonl")
        if not os.path.exists(p):
            continue
        for line in open(p):
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def main():
    rows = load_rows()
    ds = {q["id"]: q for q in json.load(open(os.path.join(REPO, "benchmark/dataset/swiftui-docs-chatbot-benchmark.v1.json")))["questions"]}
    rubric = {q["questionId"]: q for q in json.load(open(os.path.join(REPO, "benchmark/rubric/rubric.v1.json")))["questions"]}

    out = []
    per_q_kind = Counter()
    for r in rows:
        j = r.get("judge", {})
        if j.get("status") != "scored":
            continue
        det = r["grade"].get("correct")
        v = j.get("verdict")
        kind = None
        if det is True and v == "incorrect":
            kind = "det_correct__judge_incorrect"
        elif det is True and v == "partially_correct":
            kind = "det_correct__judge_partial"
        elif det is False and v == "correct":
            kind = "det_wrong__judge_correct"
        elif det is False and v == "partially_correct":
            kind = "det_wrong__judge_partial"
        if not kind:
            continue
        qid = r["question"]["questionId"]
        out.append({
            "kind": kind,
            "questionId": qid,
            "questionTitle": r["question"]["title"],
            "question": r["question"]["question"],
            "model": r["model"]["modelId"],
            "mode": r["mode"],
            "det_correct": det,
            "judge_verdict": v,
            "judge_reasoning": j.get("reasoning"),
            "judge_completeness": j.get("completeness"),
            "judge_codeExample": j.get("codeExample"),
            "judge_explanation": j.get("explanation"),
            "judge_recommendsCorrectPattern": j.get("recommendsCorrectPattern"),
            "judge_recommendsDeprecatedPattern": j.get("recommendsDeprecatedPattern"),
            "mustMention": rubric[qid]["mustMention"],
            "mustNotMention": rubric[qid]["mustNotMention"],
            "mustMentionPassed": r["grade"].get("mustMentionPassed", []),
            "mustMentionFailed": r["grade"].get("mustMentionFailed", []),
            "mustNotMentionViolated": r["grade"].get("mustNotMentionViolated", []),
            "referenceAnswer": ds[qid]["referenceAnswer"],
            "candidateAnswer": r["answer"].get("finalAnswer", ""),
            "evidenceSummary": r["answer"].get("evidenceSummary", ""),
            "citationFilePaths": r["answer"].get("citationFilePaths", []),
            "runDir": r["runDirectory"],
        })
        per_q_kind[(qid, kind)] += 1

    json.dump(out, open(os.path.join(HERE, "disagreements.json"), "w"), indent=2)

    kinds = ("det_correct__judge_incorrect", "det_correct__judge_partial",
             "det_wrong__judge_correct", "det_wrong__judge_partial")
    with open(os.path.join(HERE, "per-question-disagreements.csv"), "w") as f:
        f.write("questionId," + ",".join(kinds) + ",total\n")
        for qid in sorted({r["questionId"] for r in out}):
            counts = [per_q_kind.get((qid, k), 0) for k in kinds]
            f.write(f"{qid}," + ",".join(str(c) for c in counts) + f",{sum(counts)}\n")

    print(f"wrote {len(out)} disagreement rows")


if __name__ == "__main__":
    main()
