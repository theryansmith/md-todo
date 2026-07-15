// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import importX, { createNodeResolver } from 'eslint-plugin-import-x';

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
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
        },
        plugins: {
            'import-x': importX,
        },
        settings: {
            // The default node resolver does not resolve extensionless relative
            // imports to .ts files; without this the layering zones silently
            // never fire.
            'import-x/resolver-next': [
                createNodeResolver({ extensions: ['.ts', '.js', '.mjs', '.json'] }),
            ],
        },
        rules: {
            // Duplicate import statements from the same module are always a mistake.
            'import-x/no-duplicates': 'error',

            // Layering zones (TDD "Layering rules"). Each zone bans the layers a
            // directory may NOT import; anything not banned is allowed:
            //   core/           -> core/ only
            //   vscode/         -> core/ (+ vscode api)
            //   features/       -> core/, vscode/ (feature-to-feature imports are the
            //                      Phase 3 duplication being consolidated; not banned yet)
            //   registrations/  -> features/, vscode/, core/
            //   extension.ts    -> registrations/, vscode/ — TEMPORARY exception:
            //                      extension.ts may import features/ until the Phase 4
            //                      command registry lands, and core/ until the Phase 3b
            //                      CacheRegistry replaces the manual clear-cache
            //                      enumeration (F-11), so no zone bans it here yet.
            // The "no vscode inside src/core" ban is deferred to Phase 2 (see TDD).
            // test/ is unrestricted for now.
            'import-x/no-restricted-paths': [
                'error',
                {
                    basePath: import.meta.dirname,
                    zones: [
                        {
                            target: './src/core',
                            from: [
                                './src/vscode',
                                './src/features',
                                './src/registrations',
                                './src/extension.ts',
                            ],
                            message: 'core/ may import from core/ only.',
                        },
                        {
                            target: './src/vscode',
                            from: ['./src/features', './src/registrations', './src/extension.ts'],
                            message: 'vscode/ may import from core/ only.',
                        },
                        {
                            target: './src/features',
                            from: ['./src/registrations', './src/extension.ts'],
                            message: 'features/ may import from core/ and vscode/ only.',
                        },
                        {
                            target: './src/registrations',
                            from: ['./src/extension.ts'],
                            message:
                                'registrations/ may import from features/, vscode/, and core/ only.',
                        },
                    ],
                },
            ],

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
