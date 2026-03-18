/**
 * ESLint flat config with type-aware rules.
 *
 * Minimal config: recommendedTypeChecked preset + type import enforcement.
 * The preset includes promise safety, await-thenable, etc. out of the box.
 */

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

const typedRecommended = tseslint.configs.recommendedTypeChecked.map((cfg) => ({
  ...cfg,
  files: ['**/*.ts', '**/*.tsx'],
  languageOptions: {
    ...(cfg.languageOptions ?? {}),
    parserOptions: {
      ...(cfg.languageOptions?.parserOptions ?? {}),
      projectService: true,
      tsconfigRootDir: import.meta.dirname,
    },
  },
}));

export default [
  // Global ignores
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/attic/**',
      '**/.fleet/**',
      '**/.tbd/**',
      '**/.claude/hooks/**',
      '*.config.*',
      'scripts/**',
    ],
  },

  // Base JS rules
  js.configs.recommended,

  // Type-aware TypeScript rules
  ...typedRecommended,

  // Fleet-specific rules
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      // Allow underscore prefix for intentionally unused vars
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],

      // Enforce `import type` for type-only imports (fleet uses this pattern throughout)
      '@typescript-eslint/consistent-type-imports': [
        'error',
        {
          prefer: 'type-imports',
          fixStyle: 'separate-type-imports',
          disallowTypeAnnotations: true,
        },
      ],
    },
  },

  // Shell script generators use \$ for bash variables in template literals
  {
    files: ['**/completions.ts'],
    rules: {
      'no-useless-escape': 'off',
    },
  },

  // Relax rules for test files
  {
    files: ['**/*.test.ts', '**/*.spec.ts', '**/tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
    },
  },

  // Prettier must be last to disable conflicting formatting rules
  prettier,
];
