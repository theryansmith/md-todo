import * as vscode from 'vscode';

// Monotonically-increasing version shared by every fake doc so the parse
// cache in parser.ts (keyed by uri + version) never returns a stale parse
// for a different fixture.
let nextVersion = 1;

/**
 * Build a TextDocument-shaped fake from raw markdown text — just enough
 * surface for parseDocument and the pure line transforms. Pass `uri` to pin
 * the document identity across "versions" (e.g. to exercise per-URI caches
 * with a before/after edit pair); versions still auto-increment so the
 * (uri, version) parse cache never serves a stale parse.
 */
export function makeDoc(text: string, uri?: string): vscode.TextDocument {
    const lines = text.split('\n');
    const version = nextVersion++;
    return {
        languageId: 'markdown',
        version,
        lineCount: lines.length,
        uri: { toString: () => uri ?? `untitled:test-doc-${version}` },
        lineAt: (i: number) => ({ text: lines[i] }),
    } as unknown as vscode.TextDocument;
}
