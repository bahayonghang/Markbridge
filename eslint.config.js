import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**', 'target/**', '.trellis/**', '.agents/**', '.codex/**', '.claude/**', 'ref/**', 'runs/**', 'test-results/**', 'playwright-report/**', '**/generated/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { languageOptions: { globals: { ...globals.browser, ...globals.node } } },
);
