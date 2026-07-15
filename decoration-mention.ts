import * as vscode from 'vscode';
import { isTodoFile } from './parser';
import { applyChangesToCache, affectedNewLineRange, mergeAndSort } from './decoration-incremental';

let mentionDecorationType: vscode.TextEditorDecorationType | undefined;

const mentionDecorationCache = new Map<string, vscode.DecorationOptions[]>();

export function clearMentionDecorationCache(uri?: vscode.Uri): void {
    if (uri) {
        mentionDecorationCache.delete(uri.toString());
    } else {
        mentionDecorationCache.clear();
    }
}

export function createMentionDecorationType(): vscode.TextEditorDecorationType {
    if (mentionDecorationType) {
        mentionDecorationType.dispose();
    }
    // Distinct styling from tag decorations: bold + accent color (charts.blue)
    mentionDecorationType = vscode.window.createTextEditorDecorationType({
        color: new vscode.ThemeColor('charts.blue'),
        fontWeight: 'bold',
    });
    return mentionDecorationType;
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
        const matches = [...line.text.matchAll(/@[\w-]+/g)];
        for (const match of matches) {
            // matchAll results always carry a numeric .index
            decorations.push({
                range: new vscode.Range(i, match.index, i, match.index + match[0].length),
            });
        }
    }
    return decorations;
}

export function updateMentionDecorations(editor: vscode.TextEditor) {
    const decorationType = mentionDecorationType ?? createMentionDecorationType();
    const key = editor.document.uri.toString();

    if (!isTodoFile(editor.document)) {
        editor.setDecorations(decorationType, []);
        mentionDecorationCache.set(key, []);
        return;
    }

    const decorations = scanLineRange(editor.document, 0, editor.document.lineCount - 1);
    editor.setDecorations(decorationType, decorations);
    mentionDecorationCache.set(key, decorations);
}

export function updateMentionDecorationsIncremental(
    editor: vscode.TextEditor,
    changes: readonly vscode.TextDocumentContentChangeEvent[]
): void {
    const key = editor.document.uri.toString();
    const cached = mentionDecorationCache.get(key);
    if (!cached) {
        updateMentionDecorations(editor);
        return;
    }

    const decorationType = mentionDecorationType ?? createMentionDecorationType();

    if (!isTodoFile(editor.document)) {
        editor.setDecorations(decorationType, []);
        mentionDecorationCache.set(key, []);
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
    mentionDecorationCache.set(key, merged);
}
