import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import sonarjs from 'eslint-plugin-sonarjs'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

const mainWindowBarrelImportRestriction = {
  selector:
    'ImportDeclaration[source.type="Literal"][source.value=/\\/shell\\/mainWindow(?:\\/index(?:\\.[tj]sx?)?)?$/]',
  message:
    'Do not import shell/mainWindow as a directory barrel; use a direct file path (e.g. AppMainStage.tsx). Do not add shell/mainWindow/index.ts.',
}

const lazyUiTargetStaticImportRestriction = {
  selector:
    'ImportDeclaration[source.type="Literal"][source.value=/\\/components\\/(SettingsPage|QuickOpenNotePalette|VaultSearchPalette)(?:\\.[tj]sx?)?$/]',
  message:
    'Keep SettingsPage, QuickOpenNotePalette, and VaultSearchPalette on the AppLazyUi lazy boundary; do not eager-import these components.',
}

const lazyUiTargetImportRestrictions = [
  lazyUiTargetStaticImportRestriction,
  {
    selector:
      'ImportExpression[source.type="Literal"][source.value=/\\/components\\/(SettingsPage|QuickOpenNotePalette|VaultSearchPalette)(?:\\.[tj]sx?)?$/]',
    message:
      'Only AppLazyUi may lazy-import SettingsPage, QuickOpenNotePalette, and VaultSearchPalette.',
  },
]

const mainWindowImportBoundaryRestrictions = [
  mainWindowBarrelImportRestriction,
  ...lazyUiTargetImportRestrictions,
]

export default defineConfig([
  globalIgnores(['dist', 'src-tauri/target']),
  {
    files: ['vitest.config.ts', '../../packages/*/vitest.config.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Property[key.name="isolate"][value.value=false]',
          message:
            'Do not set Vitest test.isolate to false without superseding specs/adrs/001-adr-vitest-desktop-test-isolation.md.',
        },
      ],
    },
  },
  {
    files: ['src/editor/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@tauri-apps/*'],
              message:
                'Use shell-owned adapters under src/lib/ (not src/editor/) for Tauri APIs.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/components/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@tauri-apps/*'],
              message:
                'Use shell-owned helpers under src/lib/ for Tauri APIs (not src/components/).',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/shell/mainWindow/AppLazyUi.tsx'],
    rules: {
      'no-restricted-syntax': [
        'error',
        mainWindowBarrelImportRestriction,
        lazyUiTargetStaticImportRestriction,
      ],
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/shell/mainWindow/AppLazyUi.tsx'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...mainWindowImportBoundaryRestrictions,
      ],
    },
  },
  {
    files: ['src/App.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: './shell/mainWindow/AppLazyUi',
              message:
                'Import lazy UI through AppMainStage or AppPaletteLayer, not AppLazyUi directly.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
      sonarjs.configs.recommended,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {argsIgnorePattern: '^_', varsIgnorePattern: '^_'},
      ],
    },
  },
  {
    files: [
      '**/__tests__/**/*.{js,jsx,ts,tsx}',
      '**/*.test.{js,jsx,ts,tsx}',
      '**/*.spec.{js,jsx,ts,tsx}',
    ],
    rules: {
      // Test code intentionally uses OS temp locations for isolated fixtures.
      'sonarjs/publicly-writable-directories': 'off',
    },
  },
  {
    files: ['src/hooks/**/*.ts'],
    ignores: ['src/hooks/useInboxBodyCache.ts', 'src/hooks/**/*.test.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...mainWindowImportBoundaryRestrictions,
        {
          selector:
            'AssignmentExpression[left.type="MemberExpression"][left.property.name="current"][left.object.property.name="lastPersistedRef"]',
          message:
            'Mutate lastPersisted only via useInboxBodyCache (setLastPersistedSnapshot, clearLastPersistedSnapshot, writeLastPersistedSnapshotWithoutSeqBump + bumpLastPersistedExternalMutationSeq).',
        },
        {
          selector:
            'AssignmentExpression[left.type="MemberExpression"][left.property.name="current"][left.object.property.name="lastPersistedExternalMutationSeqRef"]',
          message:
            'Bump lastPersistedExternalMutationSeqRef only via useInboxBodyCache (bumpLastPersistedExternalMutationSeq or setLastPersistedSnapshot / clearLastPersistedSnapshot).',
        },
      ],
    },
  },
  {
    files: ['src/hooks/useMainWindowWorkspace.ts'],
    rules: {
      // Orchestration hub: callbacks read latest workspace/editor state via refs to avoid
      // stale closures; widening dependency arrays would churn identities without improving safety.
      'react-hooks/exhaustive-deps': 'off',
    },
  },
])
