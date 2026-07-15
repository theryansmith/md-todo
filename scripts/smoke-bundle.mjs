// Bundle smoke test: loads dist/extension.js exactly the way the VS Code
// extension host would (a CommonJS require), with the host-provided
// 'vscode' module stubbed out, and asserts the activation surface exists.
// This substitutes for a live-host activation check in CI until the VSIX
// is smoke-tested manually in a real VS Code window.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const bundlePath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../dist/extension.js'
);

// Minimal inert 'vscode' stub. Nothing in the bundle touches the vscode API
// at module scope (all decoration types / status-bar items are created
// lazily inside activate()), so an empty namespace is sufficient for a
// load-time smoke test.
const vscodeStub = {};

// Intercept Node's CJS loader so the bundle's `require('vscode')` (kept
// external by esbuild) resolves to the stub instead of failing.
const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
    if (request === 'vscode') {
        return vscodeStub;
    }
    return originalLoad.call(this, request, parent, isMain);
};

let extension;
try {
    extension = require(bundlePath);
} finally {
    Module._load = originalLoad;
}

assert.equal(typeof extension.activate, 'function', 'dist/extension.js must export activate()');
assert.equal(typeof extension.deactivate, 'function', 'dist/extension.js must export deactivate()');

console.log(`smoke: OK — ${path.basename(bundlePath)} exports activate() and deactivate()`);
