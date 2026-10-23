import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist', 'node_modules', '.wrangler', 'mockups', 'playwright-report', 'test-results'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        window: 'readonly',
        document: 'readonly',
        console: 'readonly',
        process: 'readonly',
      },
    },
  },
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        URL: 'readonly',
        fetch: 'readonly',
        TextDecoder: 'readonly',
        setTimeout: 'readonly',
      },
    },
  },
);
