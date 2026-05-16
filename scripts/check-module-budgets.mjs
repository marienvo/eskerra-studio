#!/usr/bin/env node
/**
 * Fails when TS/TSX modules grow beyond agreed budgets (see .me/plans lint hardening).
 * Uses scripts/module-budget-baseline.json for known megamodules and git for new/growth checks.
 */
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, '..');
export const BASELINE_PATH = path.join(__dirname, 'module-budget-baseline.json');

export const NEW_FILE_MAX_LINES = 400;
export const GROWTH_TRACK_MIN_LINES = 800;

export function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

export function countLines(absPath) {
  const raw = fs.readFileSync(absPath, 'utf8');
  if (raw.length === 0) {
    return 0;
  }
  return raw.split(/\r?\n/).length;
}

function gitOk(args, cwd) {
  try {
    execFileSync('git', args, {cwd, stdio: ['ignore', 'pipe', 'ignore']});
    return true;
  } catch {
    return false;
  }
}

function gitOut(args, cwd) {
  return execFileSync('git', args, {cwd, encoding: 'utf8'}).trim();
}

export function resolveMergeBase(cwd) {
  const prefer = process.env.MODULE_BUDGET_MERGE_BASE?.trim();
  if (prefer) {
    return prefer;
  }
  for (const ref of ['origin/main', 'origin/master', 'main', 'master']) {
    if (gitOk(['rev-parse', '--verify', ref], cwd)) {
      try {
        return gitOut(['merge-base', 'HEAD', ref], cwd);
      } catch {
        // continue
      }
    }
  }
  return null;
}

export function isScopedSource(rel) {
  if (!rel || rel.endsWith('.d.ts')) {
    return false;
  }
  if (!rel.endsWith('.ts') && !rel.endsWith('.tsx')) {
    return false;
  }
  return (
    rel.startsWith('apps/desktop/') ||
    rel.startsWith('apps/mobile/') ||
    rel.startsWith('packages/')
  );
}

export function existsAtRevision(cwd, rev, relPath) {
  try {
    execFileSync('git', ['cat-file', '-e', `${rev}:${relPath}`], {
      cwd,
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

export function countLinesAtRevision(cwd, rev, relPath) {
  const raw = execFileSync('git', ['show', `${rev}:${relPath}`], {
    cwd,
    encoding: 'utf8',
  });
  if (raw.length === 0) {
    return 0;
  }
  return raw.split(/\r?\n/).length;
}

/**
 * Paths that fail the git-based budget rules but are not yet in `maxByPath`.
 * Values are the current on-disk line counts to store as the new cap when bumping baseline.
 */
export function collectAutoBaselineAdditions(repoRoot, maxByPath) {
  /** @type {Record<string, number>} */
  const out = {};
  const mergeBase = resolveMergeBase(repoRoot);
  if (!mergeBase) {
    return out;
  }

  let branchChangedRaw = '';
  try {
    branchChangedRaw = gitOut(['diff', '--name-only', `${mergeBase}...HEAD`], repoRoot);
  } catch {
    return out;
  }

  let dirtyRaw = '';
  try {
    dirtyRaw = [
      gitOut(['diff', '--name-only', 'HEAD'], repoRoot),
      gitOut(['diff', '--name-only', '--cached', 'HEAD'], repoRoot),
    ]
      .filter(Boolean)
      .join('\n');
  } catch {
    dirtyRaw = '';
  }

  const changed = new Set(
    [branchChangedRaw, dirtyRaw]
      .join('\n')
      .split(/\n/)
      .map(s => s.trim())
      .filter(Boolean),
  );

  for (const rel of changed) {
    if (!isScopedSource(rel)) {
      continue;
    }
    const abs = path.join(repoRoot, rel);
    if (!fs.existsSync(abs)) {
      continue;
    }
    if (Object.hasOwn(maxByPath, rel)) {
      continue;
    }
    const current = countLines(abs);
    const wasNew = !existsAtRevision(repoRoot, mergeBase, rel);
    if (wasNew && current > NEW_FILE_MAX_LINES) {
      out[rel] = current;
      continue;
    }
    if (wasNew) {
      continue;
    }
    const prev = countLinesAtRevision(repoRoot, mergeBase, rel);
    if (prev >= GROWTH_TRACK_MIN_LINES && current > prev) {
      out[rel] = current;
    }
  }
  return out;
}

/**
 * @returns {string[]}
 */
export function collectBaselineCapViolations(repoRoot, maxByPath) {
  const errors = [];
  for (const [rel, cap] of Object.entries(maxByPath)) {
    const abs = path.join(repoRoot, rel);
    if (!fs.existsSync(abs)) {
      errors.push(`Baseline path missing on disk: ${rel}`);
      continue;
    }
    const n = countLines(abs);
    if (n > cap) {
      errors.push(
        `${rel}: ${n} lines exceeds baseline cap ${cap}. Shrink the module or raise the baseline deliberately.`,
      );
    }
  }
  return errors;
}

/**
 * @returns {string[]}
 */
export function collectGitBudgetViolations(repoRoot, maxByPath) {
  const errors = [];
  const mergeBase = resolveMergeBase(repoRoot);
  if (!mergeBase) {
    console.warn(
      '[check-module-budgets] No merge base (no origin/main or main). Skipping git-based new/growth checks.',
    );
    return errors;
  }

  let branchChangedRaw = '';
  try {
    branchChangedRaw = gitOut(['diff', '--name-only', `${mergeBase}...HEAD`], repoRoot);
  } catch {
    console.warn('[check-module-budgets] git diff ...HEAD failed; skipping branch change checks.');
    return errors;
  }

  let dirtyRaw = '';
  try {
    dirtyRaw = [
      gitOut(['diff', '--name-only', 'HEAD'], repoRoot),
      gitOut(['diff', '--name-only', '--cached', 'HEAD'], repoRoot),
    ]
      .filter(Boolean)
      .join('\n');
  } catch {
    dirtyRaw = '';
  }

  const changed = new Set(
    [branchChangedRaw, dirtyRaw]
      .join('\n')
      .split(/\n/)
      .map(s => s.trim())
      .filter(Boolean),
  );

  for (const rel of changed) {
    if (!isScopedSource(rel)) {
      continue;
    }
    const abs = path.join(repoRoot, rel);
    if (!fs.existsSync(abs)) {
      continue;
    }
    const current = countLines(abs);
    if (Object.hasOwn(maxByPath, rel)) {
      continue;
    }
    const wasNew = !existsAtRevision(repoRoot, mergeBase, rel);
    if (wasNew && current > NEW_FILE_MAX_LINES) {
      errors.push(
        `${rel}: new file has ${current} lines (max ${NEW_FILE_MAX_LINES} without baseline entry). Split or add an explicit baseline bump.`,
      );
      continue;
    }
    if (wasNew) {
      continue;
    }
    const prev = countLinesAtRevision(repoRoot, mergeBase, rel);
    if (prev >= GROWTH_TRACK_MIN_LINES && current > prev) {
      errors.push(
        `${rel}: grew from ${prev} to ${current} lines (files ≥${GROWTH_TRACK_MIN_LINES} lines may not grow without intentional refactor/split).`,
      );
    }
  }
  return errors;
}

export function runModuleBudgetCheck(repoRoot = REPO_ROOT) {
  const baseline = readJson(BASELINE_PATH);
  const maxByPath = baseline.maxLinesByPath ?? {};
  const capErrors = collectBaselineCapViolations(repoRoot, maxByPath);
  const gitErrors = collectGitBudgetViolations(repoRoot, maxByPath);
  return [...capErrors, ...gitErrors];
}

function isDirectCliRun() {
  const argv1 = process.argv[1];
  if (!argv1) {
    return false;
  }
  return path.resolve(argv1) === path.resolve(fileURLToPath(import.meta.url));
}

function main() {
  const errors = runModuleBudgetCheck(REPO_ROOT);
  if (errors.length) {
    console.error('[check-module-budgets] Failed:\n' + errors.join('\n'));
    process.exit(1);
  }
}

if (isDirectCliRun()) {
  main();
}
