import js from '@eslint/js';
import globals from 'globals';

export default [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: globals.node,
    },
    rules: {
      // Express error handlers must keep the 4-argument signature even when
      // `next` is unused, so allow unused args that start with an underscore
      // or are named next.
      'no-unused-vars': ['error', { args: 'after-used', argsIgnorePattern: '^(_|next$)' }],
      eqeqeq: ['error', 'always'],
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
    },
  },
];
