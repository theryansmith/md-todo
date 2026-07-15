import * as vscode from 'vscode';
import { isTodoFile } from '../../core/parse/parser';
import { applyChangesToCache, affectedNewLineRange, mergeAndSort } from './decoration-incremental';

let dateDecorationType: vscode.TextEditorDecorationType | undefined;

const dateDecorationCache = new Map<string, vscode.DecorationOptions[]>();

export function clearDateDecorationCache(uri?: vscode.Uri): void {
    if (uri) {
        dateDecorationCache.delete(uri.toString());
    } else {
        dateDecorationCache.clear();
    }
}

export function createDateDecorationType(): vscode.TextEditorDecorationType {
    const config = vscode.workspace.getConfiguration('mdTodo');
    const opacity = config.get<number>('dateOpacity', 0.5);

    if (dateDecorationType) {
        dateDecorationType.dispose();
    }

    dateDecorationType = vscode.window.createTextEditorDecorationType({
        opacity: String(opacity),
    });

    return dateDecorationType;
}

const datePattern = /`[+✓]\d{4}-\d{2}-\d{2}`/g;

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
        const matches = [...line.text.matchAll(datePattern)];
        for (const match of matches) {
            // matchAll results always carry a numeric .index
            decorations.push({
                range: new vscode.Range(i, match.index, i, match.index + match[0].length),
            });
        }
    }
    return decorations;
}

export function updateDateDecorations(editor: vscode.TextEditor) {
    const decorationType = dateDecorationType ?? createDateDecorationType();
    const key = editor.document.uri.toString();

    if (!isTodoFile(editor.document)) {
        editor.setDecorations(decorationType, []);
        dateDecorationCache.set(key, []);
        return;
    }

    const decorations = scanLineRange(editor.document, 0, editor.document.lineCount - 1);
    editor.setDecorations(decorationType, decorations);
    dateDecorationCache.set(key, decorations);
}

export function updateDateDecorationsIncremental(
    editor: vscode.TextEditor,
    changes: readonly vscode.TextDocumentContentChangeEvent[]
): void {
    const key = editor.document.uri.toString();
    const cached = dateDecorationCache.get(key);
    if (!cached) {
        updateDateDecorations(editor);
        return;
    }

    const decorationType = dateDecorationType ?? createDateDecorationType();

    if (!isTodoFile(editor.document)) {
        editor.setDecorations(decorationType, []);
        dateDecorationCache.set(key, []);
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
    dateDecorationCache.set(key, merged);
}
