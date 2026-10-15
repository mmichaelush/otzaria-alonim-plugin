// Dev-only lint. The plugin has no build: its files are classic scripts that register
// themselves on `Alonim` (an IIFE per file), so `sourceType` is "script" for plugin/js.
const js = require('@eslint/js');
const globals = require('globals');

const rules = {
  'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' }],
  'no-undef': 'error',
  eqeqeq: ['error', 'always', { null: 'ignore' }],
  'prefer-const': 'error',
  'no-var': 'error',
  'no-shadow-restricted-names': 'error',
  'no-empty': ['error', { allowEmptyCatch: true }],
  // innerHTML and friends are forbidden by ui-contract.test.js too; lint catches it earlier.
  'no-eval': 'error',
  'no-implied-eval': 'error',
  'no-new-func': 'error',
};

module.exports = [
  {
    ignores: [
      'node_modules/**',
      'catalog/**',
      '.claude/**',
      'tools/preview/out/**',
      'tools/qa/**',
      'plugin/test/fixtures/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['plugin/js/**/*.js', 'plugin/i18n/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...globals.browser, module: 'writable', Buffer: 'readonly' },
    },
    rules,
  },
  {
    files: ['plugin/test/**/*.js', 'tools/**/*.cjs', 'eslint.config.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'commonjs', globals: { ...globals.node } },
    rules,
  },
  {
    files: ['tools/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser },
    },
    rules,
  },
  {
    files: ['tools/preview/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...globals.browser, module: 'writable', Buffer: 'readonly' },
    },
    rules,
  },
];
