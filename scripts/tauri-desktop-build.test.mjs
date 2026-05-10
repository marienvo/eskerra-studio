import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(ROOT, 'scripts', 'tauri-desktop-build.mjs');
const DESKTOP_SRC_TAURI = join(ROOT, 'apps', 'desktop', 'src-tauri');

test('--print-rpm-release outputs count.unixStamp', () => {
  const out = execFileSync(process.execPath, [SCRIPT, '--print-rpm-release'], {
    cwd: ROOT,
    encoding: 'utf8',
  }).trim();
  assert.match(out, /^\d+\.\d+$/, `got: ${out}`);
});

test('tauri linux RPM config: GTK app id, desktop entry alias, and bundled PNG icon sources', () => {
  const cfg = JSON.parse(readFileSync(join(DESKTOP_SRC_TAURI, 'tauri.conf.json'), 'utf8'));
  assert.equal(cfg.identifier, 'com.eskerra.desktop');
  assert.equal(cfg.app.enableGTKAppId, true);

  const rpmFiles = cfg.bundle?.linux?.rpm?.files;
  assert.ok(rpmFiles && typeof rpmFiles === 'object');

  const aliasDest = '/usr/share/applications/com.eskerra.desktop.desktop';
  assert.ok(Object.hasOwn(rpmFiles, aliasDest), 'RPM extra files must ship the reverse-DNS desktop alias');
  assert.equal(rpmFiles[aliasDest], 'linux/com.eskerra.desktop.desktop');
  assert.ok(existsSync(join(DESKTOP_SRC_TAURI, rpmFiles[aliasDest])));

  assert.equal(cfg.bundle.linux.rpm.desktopTemplate, 'linux/eskerra.desktop.hbs');
  assert.ok(existsSync(join(DESKTOP_SRC_TAURI, cfg.bundle.linux.rpm.desktopTemplate)));

  const icons = cfg.bundle.icon;
  assert.ok(Array.isArray(icons) && icons.length > 0);
  for (const rel of icons) {
    if (typeof rel === 'string' && rel.endsWith('.png')) {
      assert.ok(existsSync(join(DESKTOP_SRC_TAURI, rel)), `missing bundle icon source: ${rel}`);
    }
  }
});
