// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import importX from 'eslint-plugin-import-x';

export default tseslint.config(
    {
        ignores: ['dist/', 'out/', 'node_modules/', 'coverage/', '*.vsix'],
    },
    eslint.configs.recommended,
    tseslint.configs.strictTypeChecked,
    tseslint.configs.stylisticTypeChecked,
    {
        files: ['**/*.ts'],
        languageOptions: {
            parserOptions: {
                projectService: {
                    // vitest.config.ts is excluded from the compile tsconfig on purpose;
                    // lint it against the default project instead.
                    allowDefaultProject: ['vitest.config.ts'],
                },
                tsconfigRootDir: import.meta.dirname,
            },
        },
        plugins: {
            'import-x': importX,
        },
        rules: {
            // Duplicate import statements from the same module are always a mistake.
            'import-x/no-duplicates': 'error',
            // Phase 1 adds import-x no-restricted-paths layering zones once src/ exists (see TDD).

            // Non-null assertions are used deliberately after explicit checks (e.g. regex
            // match groups, map lookups guarded by .has()); ban-by-default is too noisy here.
            '@typescript-eslint/no-non-null-assertion': 'off',
            // Extension entry points log activation breadcrumbs to the developer console on purpose.
            'no-console': 'off',
            // Numbers in template literals (counts, line numbers, day deltas) stringify
            // deterministically; banning them is pure noise in this codebase.
            '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
            // VS Code APIs (registerCommand, event handlers) accept thenable-returning
            // callbacks by design; async handlers passed as void-returning arguments are
            // the idiomatic extension pattern.
            '@typescript-eslint/no-misused-promises': [
                'error',
                { checksVoidReturn: { arguments: false } },
            ],
            // `label || fallback` on strings is deliberate here: empty-string labels
            // (e.g. a user with no fullname) must fall back exactly like undefined.
            '@typescript-eslint/prefer-nullish-coalescing': [
                'error',
                { ignorePrimitives: { string: true } },
            ],
            // Underscore prefix is the conventional "intentionally unused" marker
            // (e.g. required-but-ignored callback parameters).
            '@typescript-eslint/no-unused-vars': [
                'error',
                {
                    argsIgnorePattern: '^_',
                    varsIgnorePattern: '^_',
                    caughtErrorsIgnorePattern: '^_',
                },
            ],
        },
    },
    {
        // Config and build scripts are not part of the typed project graph.
        files: ['**/*.mjs'],
        extends: [tseslint.configs.disableTypeChecked],
        languageOptions: {
            globals: {
                console: 'readonly',
                process: 'readonly',
            },
        },
    }
);
