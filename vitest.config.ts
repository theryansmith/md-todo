import * as path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['test/**/*.test.ts'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'lcov'],
            // Production sources live flat in the repo root (until Phase 1 moves them
            // to src/). Measure only those; thresholds are added in Phase 5.
            include: ['*.ts'],
            exclude: ['vitest.config.ts', 'test/**'],
        },
    },
    resolve: {
        alias: {
            // Production modules import the 'vscode' host API, which only
            // exists inside a running VS Code extension host. Point it at an
            // inert mock so pure logic can be unit-tested in Node.
            vscode: path.resolve(__dirname, 'test/vscode-mock.ts'),
        },
    },
});
