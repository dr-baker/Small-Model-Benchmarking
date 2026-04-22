import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const sweepRoot = process.argv.find((arg) => arg.startsWith('--root='))?.split('=')[1] ?? '/tmp/new-model-sweep';
const watch = process.argv.includes('--watch');
const intervalMs = Number(process.argv.find((arg) => arg.startsWith('--interval-ms='))?.split('=')[1] ?? '10000');

const statusDir = path.join(sweepRoot, 'status');
const launcherLogPath = path.join(sweepRoot, 'launcher.log');
const launcherPidPath = path.join(sweepRoot, 'launcher.pid');

function clearScreen() {
  process.stdout.write('\x1bc');
}

function formatPercent(value) {
  if (value == null || Number.isNaN(value)) return '—';
  return `${(value * 100).toFixed(0)}%`;
}

function formatUpdatedAt(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toISOString().replace('T', ' ').replace('.000Z', 'Z');
}

function pad(value, width) {
  const text = String(value);
  return text.length >= width ? text : text.padEnd(width, ' ');
}

function loadStatuses() {
  if (!existsSync(statusDir)) return [];

  return readdirSync(statusDir)
    .filter((entry) => entry.endsWith('.json'))
    .map((entry) => {
      const filePath = path.join(statusDir, entry);
      return JSON.parse(readFileSync(filePath, 'utf8'));
    })
    .sort((left, right) => left.alias.localeCompare(right.alias));
}

function readLauncherPid() {
  if (!existsSync(launcherPidPath)) return null;
  return readFileSync(launcherPidPath, 'utf8').trim() || null;
}

function readLauncherTail() {
  if (!existsSync(launcherLogPath)) return [];
  const lines = readFileSync(launcherLogPath, 'utf8').trim().split('\n').filter(Boolean);
  return lines.slice(-8);
}

function summarizeStates(statuses) {
  const counts = new Map();
  for (const status of statuses) {
    counts.set(status.state, (counts.get(status.state) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([state, count]) => `${state}:${count}`)
    .join('  ');
}

function render() {
  const statuses = loadStatuses();
  const launcherPid = readLauncherPid();
  const launcherTail = readLauncherTail();

  clearScreen();
  console.log('new model sweep monitor');
  console.log(`root: ${sweepRoot}`);
  console.log(`launcher pid: ${launcherPid ?? '—'}`);
  console.log(`updated: ${new Date().toISOString()}`);
  console.log(`states: ${summarizeStates(statuses) || 'no status files yet'}`);
  console.log('');

  const header = [
    pad('model', 30),
    pad('state', 12),
    pad('runs', 8),
    pad('judge', 8),
    pad('errors', 8),
    pad('last err', 10),
    pad('last cov', 10),
    pad('note', 24),
    'updated',
  ].join(' ');
  console.log(header);
  console.log('-'.repeat(header.length));

  for (const status of statuses) {
    console.log([
      pad(status.alias, 30),
      pad(status.state, 12),
      pad(`${status.runs}`, 8),
      pad(`${status.judgeRuns}`, 8),
      pad(`${status.errors}`, 8),
      pad(formatPercent(status.lastErrorRate), 10),
      pad(formatPercent(status.lastJudgeCoverage), 10),
      pad(status.note ?? '—', 24),
      formatUpdatedAt(status.updatedAt),
    ].join(' '));
  }

  if (launcherTail.length > 0) {
    console.log('\nlauncher tail');
    console.log('-------------');
    for (const line of launcherTail) {
      console.log(line);
    }
  }

  if (!watch) {
    process.exit(0);
  }
}

render();

if (watch) {
  setInterval(render, intervalMs);
}
