import {mergeConfig} from 'vite';
import {defineConfig} from 'vitest/config';

import viteConfig from './vite.config';

export default mergeConfig(
  viteConfig,
  defineConfig({
    /**
     * Vitest still runs some `.tsx` through esbuild; without this, JSX becomes
     * `React.createElement` while `React` is not in scope (tsconfig uses `react-jsx`).
     */
    esbuild: {
      jsx: 'automatic',
    },
    test: {
      environment: 'happy-dom',
      include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
      setupFiles: ['./vitest.setup.ts'],
      clearMocks: true,
      /** Do not use `restoreMocks`: it resets `vi.mock()` factories and breaks hoisted module mocks. */
      restoreMocks: false,
      unstubGlobals: true,
      unstubEnvs: true,
      isolate: true,
      sequence: {hooks: 'list'},
    },
  }),
);
