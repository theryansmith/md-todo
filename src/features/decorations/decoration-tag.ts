import * as vscode from 'vscode';
import { isTodoFile } from '../../vscode/document-cache';
import { applyChangesToCache, affectedNewLineRange, mergeAndSort } from './decoration-incremental';

let tagDecorationType: vscode.TextEditorDecorationType | undefined;

// Cached per-URI emitted decoration list. The list always reflects the most
// recent setDecorations call for that URI. Cleared on document close (see
// extension.ts wiring).
const tagDecorationCache = new Map<string, vscode.DecorationOptions[]>();

export function clearTagDecorationCache(uri?: vscode.Uri): void {
    if (uri) {
        tagDecorationCache.delete(uri.toString());
    } else {
        tagDecorationCache.clear();
    }
}

export function createTagDecorationType(): vscode.TextEditorDecorationType {
    if (tagDecorationType) {
        tagDecorationType.dispose();
    }

    // Distinct, visible color for tags (purple). Less prominent than @mentions
    // (which are bold + charts.blue), but clearly stands out from body text.
    tagDecorationType = vscode.window.createTextEditorDecorationType({
        color: new vscode.ThemeColor('charts.purple'),
    });

    return tagDecorationType;
}

function scanLineRange(
    document: vscode.TextDocument,
    startLine: number,
    endLine: number
): vscode.DecorationOptions[] {
    const decorations: vscode.DecorationOptions[] = [];
    const lo = Math.max(0, startLine);
    const hi = Math.min(document.lineCount - 1, endLine);
    for (let i = lo; i <= hi; i++) {
        const line = document.lineAt(i);
        const matches = [...line.text.matchAll(/#[\w-]+/g)];
        for (const match of matches) {
            // matchAll results always carry a numeric .index
            decorations.push({
                range: new vscode.Range(i, match.index, i, match.index + match[0].length),
            });
        }
    }
    return decorations;
}

export function updateTagDecorations(editor: vscode.TextEditor) {
    const decorationType = tagDecorationType ?? createTagDecorationType();
    const key = editor.document.uri.toString();

    if (!isTodoFile(editor.document)) {
        editor.setDecorations(decorationType, []);
        tagDecorationCache.set(key, []);
        return;
    }

    const decorations = scanLineRange(editor.document, 0, editor.document.lineCount - 1);
    editor.setDecorations(decorationType, decorations);
    tagDecorationCache.set(key, decorations);
}

export function updateTagDecorationsIncremental(
    editor: vscode.TextEditor,
    changes: readonly vscode.TextDocumentContentChangeEvent[]
): void {
    const key = editor.document.uri.toString();
    const cached = tagDecorationCache.get(key);
    if (!cached) {
        // First time seeing this URI — fall through to the full path so we
        // populate the cache.
        updateTagDecorations(editor);
        return;
    }

    const decorationType = tagDecorationType ?? createTagDecorationType();

    if (!isTodoFile(editor.document)) {
        editor.setDecorations(decorationType, []);
        tagDecorationCache.set(key, []);
        return;
    }

    const shifted = applyChangesToCache(cached, changes);
    const rescanned: vscode.DecorationOptions[] = [];
    for (const change of changes) {
        const { startLine, endLine } = affectedNewLineRange(change);
        rescanned.push(...scanLineRange(editor.document, startLine, endLine));
    }
    const merged = mergeAndSort(shifted, rescanned);
    editor.setDecorations(decorationType, merged);
    tagDecorationCache.set(key, merged);
}
