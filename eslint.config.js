import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
      eqeqeq: ['error', 'always'],
      'no-console': 'warn',
    },
  },
  {
    files: [
      'apps/local-server/**/*.ts',
      'apps/cloud-api/**/*.ts',
      'packages/**/*.ts',
      'apps/pwa/scripts/**/*.mjs',
      '*.js',
    ],
    languageOptions: { globals: globals.node },
  },
  {
    // Scripts de linha de comando escrevem no terminal de propósito.
    files: ['**/scripts/**/*.{ts,mjs}'],
    rules: { 'no-console': 'off' },
  },
  {
    // Painel e app do cliente: navegador, regras de hooks e nada de regras financeiras na tela
    files: ['apps/admin-web/**/*.{ts,tsx}', 'apps/pwa/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Regras financeiras ficam no backend: a tela mostra o que a API calcula.
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@estacionamento/calculo',
              message: 'O cálculo das estadias é feito no servidor. Use os valores devolvidos pela API.',
            },
          ],
        },
      ],
    },
  },
);
