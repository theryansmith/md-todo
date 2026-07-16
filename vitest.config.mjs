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
            // Measure production sources only.
            include: ['src/**/*.ts'],
            // Phase 5 ratchet (F-15): overall src/ >= 60% lines, core/ >= 80%
            // lines AND branches. Enforcement verified by temporarily setting
            // impossible values (vitest exits 1 with a threshold error; the
            // global gate is computed over ALL included files, the glob gate
            // over the aggregate of src/core/**). Raising these numbers is
            // welcome; lowering them is a TDD Decision Log event.
            thresholds: {
                lines: 60,
                'src/core/**': {
                    lines: 80,
                    branches: 80,
                },
            },
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
