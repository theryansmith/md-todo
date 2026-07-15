import * as vscode from 'vscode';
import { isTodoFile } from '../../core/parser';
import { PROJECT_TOKEN_RE_G } from '../../core/tokens';
import { applyChangesToCache, affectedNewLineRange, mergeAndSort } from './decoration-incremental';

let projectDecorationType: vscode.TextEditorDecorationType | undefined;

// Cached per-URI emitted decoration list. The list always reflects the most
// recent setDecorations call for that URI. Cleared on document close (see
// extension.ts wiring).
const projectDecorationCache = new Map<string, vscode.DecorationOptions[]>();

export function clearProjectDecorationCache(uri?: vscode.Uri): void {
    if (uri) {
        projectDecorationCache.delete(uri.toString());
    } else {
        projectDecorationCache.clear();
    }
}

export function createProjectDecorationType(): vscode.TextEditorDecorationType {
    if (projectDecorationType) {
        projectDecorationType.dispose();
    }

    // Distinct, visible color for `[project]` tokens (orange) — clearly
    // separate from #tags (purple) and @mentions (bold blue).
    projectDecorationType = vscode.window.createTextEditorDecorationType({
        color: new vscode.ThemeColor('charts.orange'),
    });

    return projectDecorationType;
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
        const matches = [...line.text.matchAll(PROJECT_TOKEN_RE_G)];
        for (const match of matches) {
            // matchAll results always carry a numeric .index
            decorations.push({
                range: new vscode.Range(i, match.index, i, match.index + match[0].length),
            });
        }
    }
    return decorations;
}

export function updateProjectDecorations(editor: vscode.TextEditor) {
    const decorationType = projectDecorationType ?? createProjectDecorationType();
    const key = editor.document.uri.toString();

    if (!isTodoFile(editor.document)) {
        editor.setDecorations(decorationType, []);
        projectDecorationCache.set(key, []);
        return;
    }

    const decorations = scanLineRange(editor.document, 0, editor.document.lineCount - 1);
    editor.setDecorations(decorationType, decorations);
    projectDecorationCache.set(key, decorations);
}

export function updateProjectDecorationsIncremental(
    editor: vscode.TextEditor,
    changes: readonly vscode.TextDocumentContentChangeEvent[]
): void {
    const key = editor.document.uri.toString();
    const cached = projectDecorationCache.get(key);
    if (!cached) {
        // First time seeing this URI — fall through to the full path so we
        // populate the cache.
        updateProjectDecorations(editor);
        return;
    }

    const decorationType = projectDecorationType ?? createProjectDecorationType();

    if (!isTodoFile(editor.document)) {
        editor.setDecorations(decorationType, []);
        projectDecorationCache.set(key, []);
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
    projectDecorationCache.set(key, merged);
}
