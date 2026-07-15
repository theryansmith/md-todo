// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import importX from 'eslint-plugin-import-x';

export default tseslint.config(
    {
        ignores: ['out/', 'node_modules/', 'coverage/', '*.vsix'],
    },
    eslint.configs.recommended,
    tseslint.configs.strictTypeChecked,
    tseslint.configs.stylisticTypeChecked,
    {
        files: ['*.ts', 'test/**/*.ts'],
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
        },
    },
    {
        // Config files are not part of the typed project graph.
        files: ['eslint.config.mjs'],
        extends: [tseslint.configs.disableTypeChecked],
    }
);
