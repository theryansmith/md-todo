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
