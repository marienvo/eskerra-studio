#!/usr/bin/env node
/**
 * Updates scripts/module-budget-baseline.json caps to match current line counts on disk.
 * Also appends baseline entries for changed/new files that would fail check-module-budgets
 * without an explicit cap (same rules as collectAutoBaselineAdditions).
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  BASELINE_PATH,
  REPO_ROOT,
  collectAutoBaselineAdditions,
  countLines,
  readJson,
} from './check-module-budgets.mjs';

function main() {
  const baseline = readJson(BASELINE_PATH);
  const next = {...(baseline.maxLinesByPath ?? {})};

  for (const rel of Object.keys(next)) {
    const abs = path.join(REPO_ROOT, rel);
    if (!fs.existsSync(abs)) {
      delete next[rel];
      continue;
    }
    next[rel] = countLines(abs);
  }

  const additions = collectAutoBaselineAdditions(REPO_ROOT, next);
  for (const [rel, n] of Object.entries(additions)) {
    next[rel] = n;
  }

  const sorted = Object.fromEntries(Object.entries(next).sort(([a], [b]) => a.localeCompare(b)));
  const out = {...baseline, maxLinesByPath: sorted};
  fs.writeFileSync(BASELINE_PATH, JSON.stringify(out, null, 2) + '\n', 'utf8');
}

main();
