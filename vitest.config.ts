import * as path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['test/**/*.test.ts'],
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
