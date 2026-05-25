import {existsSync, readdirSync, statSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const assetsDir = path.join(repoRoot, 'apps/desktop/dist/assets');
const viteChunkWarningLimitKb = 2048;

const budgets = [
  {name: 'index', pattern: /^index-[\w-]+\.js$/, maxKb: 1400},
  {name: 'vendor-cm', pattern: /^vendor-cm-[\w-]+\.js$/, maxKb: 900},
  {name: 'vendor-react', pattern: /^vendor-react-[\w-]+\.js$/, maxKb: 450},
  {name: 'vendor-md', pattern: /^vendor-md-[\w-]+\.js$/, maxKb: 160},
  {name: 'SettingsPage', pattern: /^SettingsPage-[\w-]+\.js$/, maxKb: 50},
  {name: 'VaultSearchPalette', pattern: /^VaultSearchPalette-[\w-]+\.js$/, maxKb: 30},
  {name: 'QuickOpenNotePalette', pattern: /^QuickOpenNotePalette-[\w-]+\.js$/, maxKb: 20},
];

function kb(bytes) {
  return bytes / 1000;
}

function formatKb(value) {
  return `${value.toFixed(2)} kB`;
}

if (!existsSync(assetsDir)) {
  console.error(
    `[bundle-budget] Missing ${path.relative(repoRoot, assetsDir)}. Run npm run build -w @eskerra/desktop first.`,
  );
  process.exit(1);
}

const jsAssets = readdirSync(assetsDir)
  .filter(file => file.endsWith('.js'))
  .map(file => ({
    file,
    sizeKb: kb(statSync(path.join(assetsDir, file)).size),
  }));

const failures = [];

for (const asset of jsAssets) {
  if (asset.sizeKb > viteChunkWarningLimitKb) {
    failures.push(
      `${asset.file} is ${formatKb(asset.sizeKb)}, above Vite chunk warning limit ${viteChunkWarningLimitKb} kB`,
    );
  }
}

for (const budget of budgets) {
  const matches = jsAssets.filter(asset => budget.pattern.test(asset.file));
  if (matches.length === 0) {
    failures.push(`Missing expected ${budget.name} chunk (${budget.pattern})`);
    continue;
  }

  const largest = matches.reduce((max, asset) =>
    asset.sizeKb > max.sizeKb ? asset : max,
  );
  if (largest.sizeKb > budget.maxKb) {
    failures.push(
      `${budget.name} chunk ${largest.file} is ${formatKb(largest.sizeKb)}, budget ${formatKb(budget.maxKb)}`,
    );
  }
}

if (failures.length > 0) {
  console.error('[bundle-budget] Desktop Vite bundle budget failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('[bundle-budget] Desktop Vite bundle budget passed:');
for (const budget of budgets) {
  const largest = jsAssets
    .filter(asset => budget.pattern.test(asset.file))
    .reduce((max, asset) => (asset.sizeKb > max.sizeKb ? asset : max));
  console.log(`- ${budget.name}: ${formatKb(largest.sizeKb)} <= ${formatKb(budget.maxKb)}`);
}
