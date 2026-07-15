// Bundles the extension into a single dist/extension.js (see TDD Phase 1).
// The VS Code extension host requires a CommonJS entry point; 'vscode' is
// provided by the host at runtime and must stay external. Typechecking is
// a separate step (`npm run typecheck`) — esbuild does not typecheck.
import * as esbuild from 'esbuild';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const options = {
    entryPoints: ['src/extension.ts'],
    outfile: 'dist/extension.js',
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node20',
    external: ['vscode'],
    sourcemap: true,
    minify: production,
    logLevel: 'info',
};

if (watch) {
    const ctx = await esbuild.context(options);
    await ctx.watch();
} else {
    await esbuild.build(options);
}
