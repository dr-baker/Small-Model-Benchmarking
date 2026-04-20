import { readFile, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const DEFAULT_SOURCE_RELATIVE = 'benchmark/dataset/source/final-qa-bank.md';
const DEFAULT_SOURCE = path.join(REPO_ROOT, DEFAULT_SOURCE_RELATIVE);
const DEFAULT_OUTPUT = path.join(REPO_ROOT, 'benchmark', 'dataset', 'swiftui-docs-chatbot-benchmark.v1.json');
const DEFAULT_GOLD_EVIDENCE = path.join(REPO_ROOT, 'benchmark', 'dataset', 'gold-evidence.v1.json');

function parseArgs(argv) {
  const args = { source: DEFAULT_SOURCE, out: DEFAULT_OUTPUT, check: false };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg) continue;
    if (arg === '--check') {
      args.check = true;
      continue;
    }
    if (arg === '--source') {
      const next = argv[++i];
      if (!next) throw new Error('Missing value for --source');
      args.source = path.isAbsolute(next) ? next : path.resolve(REPO_ROOT, next);
      continue;
    }
    if (arg === '--out') {
      const next = argv[++i];
      if (!next) throw new Error('Missing value for --out');
      args.out = path.isAbsolute(next) ? next : path.resolve(REPO_ROOT, next);
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

function normalizeBlock(text) {
  return text.replace(/\s+$/g, '').replace(/^\s+/, '').trim();
}

function extractSectionParts(section, questionNumber) {
  const questionLabel = '**Question:**';
  const answerLabel = '**Answer:**';
  const pitfallLabel = '**Pitfall:**';

  const questionIndex = section.indexOf(questionLabel);
  const answerIndex = section.indexOf(answerLabel);
  const pitfallIndex = section.indexOf(pitfallLabel);

  if (questionIndex < 0 || answerIndex < 0 || pitfallIndex < 0) {
    throw new Error(`Missing labels in question ${questionNumber}`);
  }
  if (!(questionIndex < answerIndex && answerIndex < pitfallIndex)) {
    throw new Error(`Unexpected label order in question ${questionNumber}`);
  }

  const question = normalizeBlock(section.slice(questionIndex + questionLabel.length, answerIndex));
  const answer = normalizeBlock(section.slice(answerIndex + answerLabel.length, pitfallIndex));

  let pitfall = normalizeBlock(section.slice(pitfallIndex + pitfallLabel.length));
  const sourceNoteIndex = pitfall.indexOf('\n\n*(Source:');
  if (sourceNoteIndex >= 0) {
    pitfall = normalizeBlock(pitfall.slice(0, sourceNoteIndex));
  }
  pitfall = pitfall.replace(/(?:\n+---\s*)+$/g, '').trim();

  return { question, answer, pitfall };
}

function inferTaxonomyTags(title, question, pitfall) {
  const haystack = `${title}\n${question}\n${pitfall}`.toLowerCase();
  const tags = new Set(['swiftui']);

  const add = (...values) => values.forEach((value) => tags.add(value));

  if (/\btab\b|\btabs?\b/.test(haystack)) add('navigation', 'tabs');
  if (/navigationstack|navigationview|navigationlink|navigation/.test(haystack)) add('navigation');
  if (/toolbar/.test(haystack)) add('navigation', 'toolbars');
  if (/sheet|dialog|alert|menu|confirmation/.test(haystack)) add('presentation');
  if (/button|tap|gesture/.test(haystack)) add('interaction');
  if (/textfield|slider|searchable|search text|input/.test(haystack)) add('input');
  if (/search|filtered|filtering/.test(haystack)) add('search');
  if (/color|foreground|font|text hierarchy|label|image|badge|symbol/.test(haystack)) add('styling');
  if (/text|string|name|currency|date|number|iso 8601|replacing/.test(haystack)) add('formatting', 'strings');
  if (/animation|animatable|haptic|motion|sensoryfeedback/.test(haystack)) add('animation');
  if (/layout|frame|geometry|size|width|height|vstack|hstack|containerrelativeframe|labeledcontent/.test(haystack)) add('layout');
  if (/scroll|lazyvstack|scrollview|scrollindicator|scroll-edge/.test(haystack)) add('scrolling', 'performance');
  if (/accessibility|voiceover|differentiatewithoutcolor|reducemotion/.test(haystack)) add('accessibility');
  if (/observable|state|binding|environment|appstorage|onchange/.test(haystack)) add('state-management', 'data-flow');
  if (/observableobject|published|stateobject|observedobject|environmentobject/.test(haystack)) add('state-management', 'legacy-api');
  if (/async|await|task\(|actor|mainactor|concurrency|sleep/.test(haystack)) add('concurrency');
  if (/thread-safe|data race|main thread|dispatchqueue/.test(haystack)) add('concurrency', 'thread-safety');
  if (/keychain|userdefaults|appstorage|swiftdata|cloudkit|documents directory|filesystem|filemanager|url\.documentsdirectory/.test(haystack)) add('persistence');
  if (/keychain|secure|secret|sensitive/.test(haystack)) add('security');
  if (/swiftdata/.test(haystack)) add('swiftdata');
  if (/webview|wkwebview/.test(haystack)) add('web');
  if (/preview|#preview|previewprovider/.test(haystack)) add('previews');
  if (/asset catalog|image\(\.|generated asset|asset symbol/.test(haystack)) add('assets');
  if (/foreach|enumerated|identifiable|collection|array|count\(where\)/.test(haystack)) add('collections');
  if (/view body|view builder|some view|custom view|content closure|extract into separate/.test(haystack)) add('composition');
  if (/geometryreader|visualeffect|containerrelativeframe|layout protocol/.test(haystack)) add('layout');
  if (/webview|uiimage|uikit|wkwebview/.test(haystack)) add('interop');
  if (/performance|expensive|lazy|diffing|caching|initial load/.test(haystack)) add('performance');

  return Array.from(tags).sort();
}

function parseQuestions(markdown) {
  const headingRegex = /^## Q(\d+)\.\s+(.+)$/gm;
  const matches = Array.from(markdown.matchAll(headingRegex));

  const questions = [];
  for (let i = 0; i < matches.length; i += 1) {
    const current = matches[i];
    const next = matches[i + 1];
    if (!current) continue;
    const questionNumber = Number(current[1]);
    const title = current[2]?.trim();
    if (!title) throw new Error(`Missing title for question ${questionNumber}`);

    const start = (current.index ?? 0) + current[0].length;
    const end = next?.index ?? markdown.length;
    const section = markdown.slice(start, end);
    const { question, answer, pitfall } = extractSectionParts(section, questionNumber);
    const id = `q${String(questionNumber).padStart(2, '0')}-${slugify(title)}`;

    questions.push({
      id,
      title,
      question,
      referenceAnswer: answer,
      pitfall,
      taxonomyTags: inferTaxonomyTags(title, question, pitfall),
      questionType: 'best_practice',
      goldEvidence: [],
      source: {
        file: DEFAULT_SOURCE_RELATIVE,
        questionNumber,
      },
    });
  }

  if (questions.length === 0) {
    throw new Error('No questions found in source markdown');
  }

  return questions;
}

function classifyQuestionType(question) {
  return question.goldEvidence.length > 0 ? 'corpus_backed' : 'best_practice';
}

function mergeGoldEvidence(questions, goldEvidencePath) {
  let evidenceMap = {};
  try {
    const raw = JSON.parse(readFileSync(goldEvidencePath, 'utf8'));
    evidenceMap = raw.evidence ?? {};
  } catch {
    // No gold evidence file — leave all entries empty.
  }

  for (const question of questions) {
    question.goldEvidence = evidenceMap[question.id] ?? [];
    question.questionType = classifyQuestionType(question);
  }

  const covered = questions.filter((q) => q.goldEvidence.length > 0).length;
  return { covered, total: questions.length };
}

function buildDataset(markdown, goldEvidencePath) {
  const questions = parseQuestions(markdown);
  const questionNumbers = questions.map((question) => question.source.questionNumber);
  const expected = Array.from({ length: questions.length }, (_, index) => index + 1);

  if (questionNumbers.some((number, index) => number !== expected[index])) {
    throw new Error('Question numbers are not contiguous starting from 1');
  }

  const { covered, total } = mergeGoldEvidence(questions, goldEvidencePath);

  return {
    schemaVersion: 'dataset.v1',
    datasetId: 'swiftui-docs-chatbot-benchmark',
    datasetVersion: 'v1',
    generatedAt: '2026-04-10',
    source: {
      file: DEFAULT_SOURCE_RELATIVE,
      format: 'markdown',
      questionCount: questions.length,
    },
    goldEvidenceCurationRequired: covered < total,
    notes:
      `goldEvidence populated for ${covered}/${total} questions from benchmark/dataset/gold-evidence.v1.json. Questions with corpus evidence are marked corpus_backed; questions without direct corpus evidence are marked best_practice.`,
    questions,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const markdown = await readFile(args.source, 'utf8');
  const dataset = buildDataset(markdown, DEFAULT_GOLD_EVIDENCE);
  const output = `${JSON.stringify(dataset, null, 2)}\n`;

  if (args.check) {
    const existing = await readFile(args.out, 'utf8');
    if (existing !== output) {
      throw new Error(`${path.relative(REPO_ROOT, args.out)} is out of date. Re-run scripts/build-dataset.mjs.`);
    }
    console.log(`Validated ${dataset.questions.length} questions in ${path.relative(REPO_ROOT, args.out)}`);
    return;
  }

  await writeFile(args.out, output, 'utf8');
  console.log(`Wrote ${path.relative(REPO_ROOT, args.out)} from ${path.relative(REPO_ROOT, args.source)}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
