import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BRAND_DIR = join(ROOT, 'assets', 'brand');
const DESKTOP_DIR = join(ROOT, 'apps', 'desktop', 'src-tauri', 'icons');

test('icon manifest keeps desktop and Android icon inputs separate', () => {
  const manifest = JSON.parse(readFileSync(join(BRAND_DIR, 'eskerra-icon-manifest.json'), 'utf8'));
  assert.equal(manifest.default, 'eskerra-logo-desktop-icon.png');
  assert.equal(manifest.android_fg, 'eskerra-logo-app-icon.png');
  assert.notEqual(manifest.default, manifest.android_fg);
  assert.equal(manifest.android_fg_scale, 100);

  assert.ok(existsSync(join(BRAND_DIR, manifest.default)));
  assert.ok(existsSync(join(BRAND_DIR, manifest.android_fg)));
});

test('desktop master and generated desktop icons stay visibly larger than Android-safe foreground', () => {
  let identifyPath = '';
  try {
    identifyPath = execFileSync('bash', ['-lc', 'command -v identify'], {
      cwd: ROOT,
      encoding: 'utf8',
    }).trim();
  } catch {
    return;
  }

  const desktopTrim = execFileSync(
    identifyPath,
    ['-format', '%[fx:w] %[fx:h] %@', join(BRAND_DIR, 'eskerra-logo-desktop-icon.png')],
    { cwd: ROOT, encoding: 'utf8' },
  ).trim();
  const androidTrim = execFileSync(
    identifyPath,
    ['-format', '%[fx:w] %[fx:h] %@', join(BRAND_DIR, 'eskerra-logo-app-icon.png')],
    { cwd: ROOT, encoding: 'utf8' },
  ).trim();
  const desktop128Trim = execFileSync(
    identifyPath,
    ['-format', '%[fx:w] %[fx:h] %@', join(DESKTOP_DIR, '128x128.png')],
    { cwd: ROOT, encoding: 'utf8' },
  ).trim();

  assert.match(desktopTrim, /^1024 1024 \d+x\d+\+\d+\+\d+$/);
  assert.match(androidTrim, /^1024 1024 \d+x\d+\+\d+\+\d+$/);
  assert.match(desktop128Trim, /^128 128 \d+x\d+\+\d+\+\d+$/);

  const [, , desktopBox] = desktopTrim.split(' ');
  const [, , androidBox] = androidTrim.split(' ');
  const [, , desktop128Box] = desktop128Trim.split(' ');

  const [, , desktopHeight] = desktopBox.match(/^(\d+)x(\d+)\+\d+\+\d+$/) ?? [];
  const [, , androidHeight] = androidBox.match(/^(\d+)x(\d+)\+\d+\+\d+$/) ?? [];
  const [, , generatedHeight] = desktop128Box.match(/^(\d+)x(\d+)\+\d+\+\d+$/) ?? [];

  assert.ok(Number(desktopHeight) > Number(androidHeight));
  assert.ok(Number(generatedHeight) >= 120, `expected near-full-height 128 icon, got ${desktop128Box}`);
});
