import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TextDocumentLike } from '../../src/core/text-document';

/**
 * Build a TextDocumentLike from raw markdown text. The pure core parser has
 * no cache, so no uri/version/languageId is needed — and nothing here touches
 * the vscode mock: unit tests must pass even with the alias removed.
 */
export function makeDoc(text: string): TextDocumentLike {
    const lines = text.split('\n');
    return {
        lineCount: lines.length,
        lineAt: (i: number) => ({ text: lines[i] }),
    };
}

/**
 * Load a golden fixture from test/fixtures/ as a raw string. Line endings are
 * normalized to LF so the tests are immune to git's CRLF checkout behavior on
 * Windows. The file's trailing newline is KEPT: split('\n') then yields a
 * final empty line, exactly like a real editor buffer that ends with a
 * newline — golden line numbers in the tests account for it.
 */
export function loadFixture(name: string): string {
    // vitest always runs with the repo root as cwd (the vitest.config.mjs
    // directory); import.meta.url would be nicer but the CommonJS tsconfig
    // the typecheck step uses rejects it.
    const path = join(process.cwd(), 'test', 'fixtures', name);
    return readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
}
