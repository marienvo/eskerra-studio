#!/usr/bin/env node
/**
 * Updates scripts/module-budget-baseline.json caps to match current line counts on disk.
 * Also appends baseline entries for changed/new files that would fail check-module-budgets
 * without an explicit cap (same rules as collectAutoBaselineAdditions).
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  BASELINE_PATH,
  NEW_FILE_MAX_LINES,
  REPO_ROOT,
  collectAutoBaselineAdditions,
  countLines,
  readJson,
} from './check-module-budgets.mjs';

export function buildUpdatedMaxLinesByPath(
  maxLinesByPath,
  {pathExists, countLinesForPath, autoBaselineAdditions = {}},
) {
  const next = {...maxLinesByPath};

  for (const rel of Object.keys(next)) {
    if (!pathExists(rel)) {
      delete next[rel];
      continue;
    }

    const current = countLinesForPath(rel);
    if (current <= NEW_FILE_MAX_LINES) {
      delete next[rel];
      continue;
    }
    next[rel] = current;
  }

  for (const [rel, n] of Object.entries(autoBaselineAdditions)) {
    if (n > NEW_FILE_MAX_LINES) {
      next[rel] = n;
    }
  }

  return next;
}

function main() {
  const baseline = readJson(BASELINE_PATH);
  const maxLinesByPath = baseline.maxLinesByPath ?? {};
  const next = buildUpdatedMaxLinesByPath(maxLinesByPath, {
    pathExists: rel => fs.existsSync(path.join(REPO_ROOT, rel)),
    countLinesForPath: rel => countLines(path.join(REPO_ROOT, rel)),
    autoBaselineAdditions: collectAutoBaselineAdditions(REPO_ROOT, maxLinesByPath),
  });

  const sorted = Object.fromEntries(Object.entries(next).sort(([a], [b]) => a.localeCompare(b)));
  const out = {...baseline, maxLinesByPath: sorted};
  fs.writeFileSync(BASELINE_PATH, JSON.stringify(out, null, 2) + '\n', 'utf8');
}

function isDirectCliRun() {
  const argv1 = process.argv[1];
  if (!argv1) {
    return false;
  }
  return path.resolve(argv1) === path.resolve(fileURLToPath(import.meta.url));
}

if (isDirectCliRun()) {
  main();
}
