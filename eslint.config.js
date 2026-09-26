import js from '@eslint/js';
import globals from 'globals';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'logs/**',
    ],
  },

  {
    files: ['**/*.ts'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
    ],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      globals: globals.browser,
    },
  },

  {
    files: [
      'server/**/*.ts',
      'shared/**/*.ts',
      'scripts/**/*.ts',
      'tests/**/*.ts',
      'vite.config.ts',
    ],
    languageOptions: {
      globals: globals.node,
    },
  },
);