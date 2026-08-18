const { defineConfig, globalIgnores } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  globalIgnores([
    'node_modules/**',
    '.expo/**',
    'dist/**',
    'web-build/**',
    'coordinateTest/**',
  ]),
  expoConfig,
  {
    // The SDK 57 starter's hydration hook intentionally flips this flag once
    // after mount; keep the generated web hook lint-clean under React 19.
    rules: {
      'react-hooks/set-state-in-effect': 'off',
    },
  },
]);
