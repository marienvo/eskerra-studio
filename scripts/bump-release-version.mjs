#!/usr/bin/env node
/**
 * Before release APK: bump semver from apps/mobile/package.json based on git branch/commit
 * history stored in .local/build-version-state.json (gitignored). Also syncs Android
 * Gradle, then desktop package.json, Cargo.toml, metainfo, and canonical mobile semver.
 * Detached HEAD uses branch id "detached" (stable) so commits do not each trigger a minor bump.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  decideBump,
  mergeState,
  parseSemver,
  releaseBumpBranchId,
} from './bump-release-version-lib.mjs';
import {
  applySemverToCargoLockPackageVersion,
  applySemverToCargoTomlPackageVersion,
  applySemverToDesktopPackageJson,
  prependMetainfoReleaseIfNew,
} from './sync-app-version-artifacts-lib.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const STATE_DIR = join(ROOT, '.local');
const STATE_FILE = join(STATE_DIR, 'build-version-state.json');
const PACKAGE_JSON = join(ROOT, 'apps', 'mobile', 'package.json');
const DESKTOP_PACKAGE_JSON = join(ROOT, 'apps', 'desktop', 'package.json');
const DESKTOP_CARGO_TOML = join(
  ROOT,
  'apps',
  'desktop',
  'src-tauri',
  'Cargo.toml',
);
// Workspace root Cargo.toml: holds [workspace.package] version, inherited by
// internal crates (eskerra-reminder-core today, the daemon in Phase 2).
const WORKSPACE_CARGO_TOML = join(ROOT, 'Cargo.toml');
// Lives at the workspace root (apps/desktop/src-tauri is now a workspace
// member; cargo resolves/locks the whole workspace from one root lockfile).
const DESKTOP_CARGO_LOCK = join(ROOT, 'Cargo.lock');
const DESKTOP_METAINFO = join(
  ROOT,
  'apps',
  'desktop',
  'src-tauri',
  'metainfo',
  'eskerra.metainfo.xml',
);
const BUILD_GRADLE = join(
  ROOT,
  'apps',
  'mobile',
  'android',
  'app',
  'build.gradle',
);

function git(...args) {
  return execFileSync('git', args, {
    cwd: ROOT,
    encoding: 'utf8',
  }).trim();
}

function normalizeStateData(parsed) {
  const rawBranches = Array.isArray(parsed.branchesBuilt)
    ? parsed.branchesBuilt.map(String)
    : [];
  const branches = [];
  for (const b of rawBranches) {
    const canonical = b.startsWith('detached:') ? 'detached' : b;
    if (!branches.includes(canonical)) {
      branches.push(canonical);
    }
  }
  const commits = Array.isArray(parsed.commitsBuilt)
    ? parsed.commitsBuilt.map(String)
    : [];
  return { branchesBuilt: branches, commitsBuilt: commits };
}

function readState() {
  if (!existsSync(STATE_FILE)) {
    return {
      exists: false,
      data: { branchesBuilt: [], commitsBuilt: [] },
    };
  }
  const raw = readFileSync(STATE_FILE, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Invalid JSON in ${STATE_FILE}`);
  }
  return {
    exists: true,
    data: normalizeStateData(parsed),
  };
}

function writeState(data) {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(
    STATE_FILE,
    `${JSON.stringify(
      {
        branchesBuilt: data.branchesBuilt,
        commitsBuilt: data.commitsBuilt,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
}

function resolveBranchId() {
  const ref = git('rev-parse', '--abbrev-ref', 'HEAD');
  return releaseBumpBranchId(ref);
}

function readPackageVersion() {
  const pkg = JSON.parse(readFileSync(PACKAGE_JSON, 'utf8'));
  const v = pkg.version;
  if (typeof v !== 'string' || !parseSemver(v)) {
    throw new Error(`package.json "version" must be MAJOR.MINOR.PATCH, got: ${v}`);
  }
  return { pkg, version: v };
}

function writePackageVersion(pkg, version) {
  pkg.version = version;
  writeFileSync(
    PACKAGE_JSON,
    `${JSON.stringify(pkg, null, 2)}\n`,
    'utf8',
  );
}

/** @returns {{ versionCode: number; versionName: string }} */
function readGradleVersions() {
  const gradle = readFileSync(BUILD_GRADLE, 'utf8');
  const codeM = /versionCode\s+(\d+)/.exec(gradle);
  const nameM = /versionName\s+"([^"]*)"/.exec(gradle);
  if (!codeM || !nameM) {
    throw new Error(
      `Could not parse versionCode/versionName in ${BUILD_GRADLE}`,
    );
  }
  return {
    versionCode: Number(codeM[1]),
    versionName: nameM[1],
  };
}

function writeGradleVersions(versionCode, versionName) {
  let gradle = readFileSync(BUILD_GRADLE, 'utf8');
  gradle = gradle.replace(/versionCode\s+\d+/, `versionCode ${versionCode}`);
  gradle = gradle.replace(
    /versionName\s+"[^"]*"/,
    `versionName "${versionName}"`,
  );
  writeFileSync(BUILD_GRADLE, gradle, 'utf8');
}

/** @param {string} version */
function syncDesktopReleaseArtifacts(version) {
  const dateUtc = new Date().toISOString().slice(0, 10);
  const deskPkg = readFileSync(DESKTOP_PACKAGE_JSON, 'utf8');
  writeFileSync(
    DESKTOP_PACKAGE_JSON,
    applySemverToDesktopPackageJson(deskPkg, version),
    'utf8',
  );
  const cargo = readFileSync(DESKTOP_CARGO_TOML, 'utf8');
  writeFileSync(
    DESKTOP_CARGO_TOML,
    applySemverToCargoTomlPackageVersion(cargo, version),
    'utf8',
  );
  // [workspace.package] version: the first `version = "…"` line in the root
  // Cargo.toml. Drives every crate using `version.workspace = true`.
  const workspaceCargo = readFileSync(WORKSPACE_CARGO_TOML, 'utf8');
  writeFileSync(
    WORKSPACE_CARGO_TOML,
    applySemverToCargoTomlPackageVersion(workspaceCargo, version),
    'utf8',
  );
  // Both the app crate and the workspace-versioned core crate carry their own
  // [[package]] version in the single root lockfile; stamp both.
  let cargoLock = readFileSync(DESKTOP_CARGO_LOCK, 'utf8');
  cargoLock = applySemverToCargoLockPackageVersion(cargoLock, 'app', version);
  // Workspace-versioned internal crates (version.workspace = true) each carry
  // their own [[package]] version in the single root lockfile; stamp them all.
  for (const crate of [
    'eskerra-reminder-core',
    'eskerra-vault-watch',
    'eskerra-reminderd',
  ]) {
    cargoLock = applySemverToCargoLockPackageVersion(cargoLock, crate, version);
  }
  writeFileSync(DESKTOP_CARGO_LOCK, cargoLock, 'utf8');
  const meta = readFileSync(DESKTOP_METAINFO, 'utf8');
  writeFileSync(
    DESKTOP_METAINFO,
    prependMetainfoReleaseIfNew(meta, version, dateUtc),
    'utf8',
  );
}

function main() {
  const branchId = resolveBranchId();
  const commitSha = git('rev-parse', 'HEAD');

  const { exists, data: state } = readState();
  const { pkg, version: currentSemver } = readPackageVersion();

  const decision = decideBump(
    exists,
    state,
    branchId,
    commitSha,
    currentSemver,
  );

  let nextState = state;
  if (decision.registerBranch || decision.registerCommit) {
    nextState = mergeState(
      state,
      decision.registerBranch,
      decision.registerCommit,
    );
  }

  if (decision.kind === 'baseline') {
    writeState(nextState);
    console.log(
      `[bump-release-version] Baseline: recorded branch "${branchId}" and commit ${commitSha.slice(0, 7)} (no version change).`,
    );
    return;
  }

  if (decision.kind === 'noop') {
    writeState(nextState);
    console.log(
      `[bump-release-version] No bump (branch and commit already built). Version ${decision.newVersion}.`,
    );
    return;
  }

  const gradle = readGradleVersions();
  const nextCode = gradle.versionCode + decision.versionCodeDelta;

  writePackageVersion(pkg, decision.newVersion);
  writeGradleVersions(nextCode, decision.newVersion);
  syncDesktopReleaseArtifacts(decision.newVersion);
  writeState(nextState);

  console.log(
    `[bump-release-version] ${decision.kind}: ${currentSemver} → ${decision.newVersion} (versionCode ${gradle.versionCode} → ${nextCode}).`,
  );
}

main();
