import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const appRoot = process.cwd();
const repoRoot = path.resolve(appRoot, '..', '..');

const datasetPath = path.join(repoRoot, 'benchmark', 'dataset', 'swiftui-docs-chatbot-benchmark.v1.json');
const rubricPath = path.join(repoRoot, 'benchmark', 'rubric', 'rubric.v1.json');
const outputPath = path.join(appRoot, 'src', 'generated', 'question-bank.json');

const dataset = JSON.parse(readFileSync(datasetPath, 'utf8'));
const rubric = JSON.parse(readFileSync(rubricPath, 'utf8'));

const rubricByQuestion = Object.fromEntries(
  (rubric.questions ?? []).map((entry) => [entry.questionId, entry]),
);

const questions = Object.fromEntries(
  (dataset.questions ?? []).map((question, index) => [
    question.id,
    {
      id: question.id,
      order: question.source?.questionNumber ?? index + 1,
      title: question.title,
      question: question.question,
      referenceAnswer: question.referenceAnswer,
      pitfall: question.pitfall ?? '',
      evidenceBasis: question.evidenceBasis,
      platformScope: question.platformScope,
      questionShape: question.questionShape,
      taxonomyTags: question.taxonomyTags ?? [],
      goldEvidence: question.goldEvidence ?? [],
      rubric: {
        mustMention: rubricByQuestion[question.id]?.mustMention ?? [],
        mustMentionAnyOf: rubricByQuestion[question.id]?.mustMentionAnyOf ?? [],
        mustNotMention: rubricByQuestion[question.id]?.mustNotMention ?? [],
        passThreshold: rubricByQuestion[question.id]?.passThreshold,
      },
    },
  ]),
);

const payload = {
  benchmarkName: dataset.datasetId,
  datasetVersion: dataset.datasetVersion,
  rubricVersion: rubric.version,
  generatedAt: new Date().toISOString(),
  questions,
};

mkdirSync(path.dirname(outputPath), { recursive: true });
writeFileSync(outputPath, JSON.stringify(payload, null, 2) + '\n');
console.log(`Wrote ${outputPath}`);
