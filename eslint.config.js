import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      // §21: no `any` without a comment explaining why (use an eslint-disable comment with a reason).
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    // shared must stay pure: no DOM globals there.
    files: ['packages/client/**/*.ts'],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    // §21: rules in shared must be deterministic. Randomness goes through rng.ts, time is passed in.
    files: ['packages/shared/src/**/*.ts'],
    ignores: ['packages/shared/src/**/*.test.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Use the seeded RNG in shared/src/rng.ts.' },
        { object: 'Date', property: 'now', message: 'Pass time into rules instead of reading the clock.' },
      ],
      // §15.2: shared has no Phaser, no Colyseus and no Node APIs, so client and server can both run it.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['phaser', 'phaser/*'], message: 'shared must not depend on Phaser.' },
            {
              group: ['colyseus', 'colyseus.js', '@colyseus/*'],
              message: 'shared must not depend on Colyseus.',
            },
            { group: ['node:*'], message: 'shared must not use Node APIs.' },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'performance', message: 'Pass time into rules instead of reading the clock.' },
        { name: 'process', message: 'shared must not use Node APIs.' },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: 'new Date() reads the clock; pass time into rules instead.',
        },
      ],
    },
  },
  prettier,
);
