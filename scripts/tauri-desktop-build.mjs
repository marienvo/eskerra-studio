#!/usr/bin/env node
/**
 * Runs `scripts/bump-release-version.mjs` (same branch/commit rules as APK release),
 * then `tauri build` with a merged config that sets `bundle.linux.rpm.release`.
 * Each invocation uses a new release value so RPM NEVRA increases and
 * `dnf install` / `rpm -Uvh` can upgrade without uninstall.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DESKTOP = join(ROOT, 'apps', 'desktop');
const BUMP_RELEASE_VERSION = join(ROOT, 'scripts', 'bump-release-version.mjs');

function git(...args) {
  return execFileSync('git', args, {
    cwd: ROOT,
    encoding: 'utf8',
  }).trim();
}

function computeRpmRelease() {
  const revCount = git('rev-list', '--count', 'HEAD');
  const n = Number(revCount);
  const countPart = Number.isFinite(n) && n >= 0 ? String(n) : '0';
  let stamp;
  if (process.env.SOURCE_DATE_EPOCH != null && process.env.SOURCE_DATE_EPOCH !== '') {
    stamp = String(process.env.SOURCE_DATE_EPOCH);
  } else {
    stamp = String(Math.floor(Date.now() / 1000));
  }
  return `${countPart}.${stamp}`;
}

if (process.argv.includes('--print-rpm-release')) {
  console.log(computeRpmRelease());
  process.exit(0);
}

execFileSync(process.execPath, [BUMP_RELEASE_VERSION], {
  cwd: ROOT,
  stdio: 'inherit',
});

// Build the reminder daemon (release) into the workspace target dir so the RPM
// `files` map can install /usr/bin/eskerra-reminderd
// (= ../../../target/release/eskerra-reminderd, relative to src-tauri). The
// daemon ships in the same RPM as the app (ADR 003 §2/§9); `tauri build` only
// builds the app binary, so we build the daemon here first.
execFileSync('cargo', ['build', '--release', '-p', 'eskerra-reminderd'], {
  cwd: ROOT,
  stdio: 'inherit',
});

const release = computeRpmRelease();
const overlay = {
  bundle: {
    linux: {
      rpm: {
        release,
      },
    },
  },
};

const tmpDir = mkdtempSync(join(tmpdir(), 'tauri-desktop-build-'));
const overlayPath = join(tmpDir, 'rpm-release.json');
writeFileSync(overlayPath, JSON.stringify(overlay));
console.log(`[tauri-desktop-build] Merged RPM release: ${release}`);

let exitCode = 1;
try {
  const result = spawnSync(
    'npm',
    ['run', 'tauri', '--', 'build', '--config', overlayPath],
    {
      cwd: DESKTOP,
      stdio: 'inherit',
      env: process.env,
    },
  );
  exitCode = result.status ?? 1;
} finally {
  rmSync(tmpDir, { recursive: true, force: true });
}

process.exit(exitCode);
