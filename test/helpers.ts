import * as vscode from 'vscode';

// Monotonically-increasing version shared by every fake doc so the parse
// cache in parser.ts (keyed by uri + version) never returns a stale parse
// for a different fixture.
let nextVersion = 1;

/**
 * Build a TextDocument-shaped fake from raw markdown text — just enough
 * surface for parseDocument and the pure line transforms.
 */
export function makeDoc(text: string): vscode.TextDocument {
    const lines = text.split('\n');
    const version = nextVersion++;
    return {
        languageId: 'markdown',
        version,
        lineCount: lines.length,
        uri: { toString: () => `untitled:test-doc-${version}` },
        lineAt: (i: number) => ({ text: lines[i] }),
    } as unknown as vscode.TextDocument;
}
