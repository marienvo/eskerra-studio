import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import sonarjs from 'eslint-plugin-sonarjs'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

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
            'Do not set Vitest test.isolate to false without superseding specs/adrs/adr-vitest-desktop-test-isolation.md.',
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
    files: ['src/hooks/useMainWindowWorkspace.ts'],
    rules: {
      // Orchestration hub: callbacks read latest workspace/editor state via refs to avoid
      // stale closures; widening dependency arrays would churn identities without improving safety.
      'react-hooks/exhaustive-deps': 'off',
    },
  },
])
