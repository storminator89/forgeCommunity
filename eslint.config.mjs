import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';

export default defineConfig([
  ...nextVitals,
  {
    // Match eslint-config-next's plugin scope. Server-side .cjs utilities do
    // not register react-hooks, so an unscoped override breaks ESLint there.
    files: ['**/*.{js,jsx,mjs,ts,tsx,mts,cts}'],
    // Next 16 surfaces React Compiler diagnostics for code that is still
    // valid React. Keep the diagnostics visible while the components migrate;
    // Core hook ordering remains an error; dependency checks stay visible from
    // nextVitals while these compiler diagnostics are migrated.
    rules: {
      'react-hooks/error-boundaries': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/static-components': 'warn',
    },
  },
  globalIgnores([
    '.next/**',
    'out/**',
    'build/**',
    'coverage/**',
    'node_modules/**',
    // Checked-in upstream distribution; its one modified utility is covered
    // by the pinned provenance and diagnostic parity checks.
    'vendor/next-eslint-plugin-next/**',
    'next-env.d.ts',
  ]),
]);
