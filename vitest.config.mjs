import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
    test: {
        include: ['test/**/*.test.ts'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'lcov'],
            // Measure production sources only; thresholds are added in Phase 5.
            include: ['src/**/*.ts'],
        },
    },
    resolve: {
        alias: {
            // Production modules import the 'vscode' host API, which only
            // exists inside a running VS Code extension host. Point it at an
            // inert mock so pure logic can be unit-tested in Node.
            vscode: path.resolve(dirname, 'test/mocks/vscode.ts'),
        },
    },
});
