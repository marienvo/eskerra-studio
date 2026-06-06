#!/usr/bin/env node
/**
 * Fails if canonical mobile semver does not match desktop package.json,
 * Cargo.toml [package] version, metainfo first <release>, and Cargo.lock root package.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getFirstMetainfoReleaseVersion } from './sync-app-version-artifacts-lib.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

function readJsonVersion(path) {
  const j = JSON.parse(readFileSync(path, 'utf8'));
  if (typeof j.version !== 'string') {
    throw new Error(`Missing "version" in ${path}`);
  }
  return j.version;
}

function readCargoTomlPackageVersion(path) {
  const text = readFileSync(path, 'utf8');
  const m = /^version\s*=\s*"([^"]*)"/m.exec(text);
  if (!m) {
    throw new Error(`No package version line in ${path}`);
  }
  return m[1];
}

function readCargoLockPackageVersion(crateName) {
  // Workspace root lockfile (apps/desktop/src-tauri is a workspace member).
  const lock = readFileSync(join(ROOT, 'Cargo.lock'), 'utf8');
  const re = new RegExp(
    `\\[\\[package\\]\\]\\s*\\nname = "${crateName}"\\s*\\nversion = "([^"]*)"`,
    'm',
  );
  const m = re.exec(lock);
  if (!m) {
    throw new Error(`Could not find [[package]] name = "${crateName}" in Cargo.lock`);
  }
  return m[1];
}

function main() {
  const mobilePkg = join(ROOT, 'apps', 'mobile', 'package.json');
  const desktopPkg = join(ROOT, 'apps', 'desktop', 'package.json');
  const cargoToml = join(ROOT, 'apps', 'desktop', 'src-tauri', 'Cargo.toml');
  // Root [workspace.package] version (first `version = "…"` line), inherited by
  // crates using `version.workspace = true` such as eskerra-reminder-core. The
  // core crate itself has no literal version line, so it is validated via this
  // workspace version plus its Cargo.lock [[package]] entry below.
  const workspaceCargoToml = join(ROOT, 'Cargo.toml');
  const metainfo = join(
    ROOT,
    'apps',
    'desktop',
    'src-tauri',
    'metainfo',
    'eskerra.metainfo.xml',
  );

  const expected = readJsonVersion(mobilePkg);
  const checks = [
    ['apps/desktop/package.json', readJsonVersion(desktopPkg)],
    ['apps/desktop/src-tauri/Cargo.toml', readCargoTomlPackageVersion(cargoToml)],
    [
      'eskerra.metainfo.xml (first release)',
      getFirstMetainfoReleaseVersion(readFileSync(metainfo, 'utf8')),
    ],
    ['Cargo.lock (package app)', readCargoLockPackageVersion('app')],
    ['Cargo.toml ([workspace.package])', readCargoTomlPackageVersion(workspaceCargoToml)],
    [
      'Cargo.lock (package eskerra-reminder-core)',
      readCargoLockPackageVersion('eskerra-reminder-core'),
    ],
    [
      'Cargo.lock (package eskerra-vault-watch)',
      readCargoLockPackageVersion('eskerra-vault-watch'),
    ],
    [
      'Cargo.lock (package eskerra-reminderd)',
      readCargoLockPackageVersion('eskerra-reminderd'),
    ],
  ];

  const bad = checks.filter(([, actual]) => actual !== expected);
  if (bad.length > 0) {
    console.error('[assert-app-versions-align] Mismatch with canonical mobile version:', expected);
    for (const [label, actual] of bad) {
      console.error(`  ${label}: got ${JSON.stringify(actual)}`);
    }
    process.exit(1);
  }
  console.log(`[assert-app-versions-align] All versions match mobile ${expected}.`);
}

main();
