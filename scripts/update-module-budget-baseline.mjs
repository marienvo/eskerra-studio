#!/usr/bin/env node
/**
 * Rewrites scripts/module-budget-baseline.json so each listed path's cap matches the
 * current on-disk line count. Drops baseline entries whose files no longer exist.
 * Run after intentional megamodule changes; commit the JSON diff deliberately.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const BASELINE_PATH = path.join(__dirname, 'module-budget-baseline.json');

function countLines(absPath) {
  const raw = fs.readFileSync(absPath, 'utf8');
  if (raw.length === 0) {
    return 0;
  }
  return raw.split(/\r?\n/).length;
}

function main() {
  const raw = fs.readFileSync(BASELINE_PATH, 'utf8');
  const baseline = JSON.parse(raw);
  const maxByPath = baseline.maxLinesByPath ?? {};
  const next = {};
  const dropped = [];

  for (const rel of Object.keys(maxByPath).sort()) {
    const abs = path.join(REPO_ROOT, rel);
    if (!fs.existsSync(abs)) {
      dropped.push(rel);
      continue;
    }
    next[rel] = countLines(abs);
  }

  const out = JSON.stringify({maxLinesByPath: next}, null, 2) + '\n';
  fs.writeFileSync(BASELINE_PATH, out, 'utf8');

  console.log(
    `[update-module-budget-baseline] Wrote ${Object.keys(next).length} path cap(s) to module-budget-baseline.json`,
  );
  if (dropped.length) {
    console.warn(
      `[update-module-budget-baseline] Removed ${dropped.length} missing path(s):\n  ${dropped.join('\n  ')}`,
    );
  }
}

main();
