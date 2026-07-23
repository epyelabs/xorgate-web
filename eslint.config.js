import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      // Codified exceptions (offline-recording plan, Phase 6.10) so lint is
      // green and gating again. These three react-hooks compiler-preview rules
      // flag long-standing idioms in this codebase (effect-based pollers that
      // setState, memo-less icon/component lookups); they are aspirational
      // cleanups, not regressions — keep them visible as warnings, fix
      // opportunistically when touching those files.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/static-components': 'warn',
    },
  },
  {
    // Route modules and shared hook/context/ui files export non-component
    // values (TanStack `Route` objects, hooks, cva variants) alongside
    // components by convention — the fast-refresh constraint doesn't fit
    // them. Scoped off rather than globally so new plain component files
    // still get checked.
    files: [
      'src/routes/**/*.{ts,tsx}',
      'src/components/ui/**/*.{ts,tsx}',
      'src/components/live-video-grid.tsx',
      'src/hooks/**/*.{ts,tsx}',
    ],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
])
