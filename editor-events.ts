import * as vscode from 'vscode';
import { updateTagDecorations } from './decoration-tag';
import { createDateDecorationType, updateDateDecorations } from './decoration-date';
import { updateMentionDecorations } from './decoration-mention';
import { updateDimDecorations } from './decoration-dim';
import { refreshFocusStatusBar } from './focus-user';
import { refreshFocusTagStatusBar } from './focus-tag';
import { refreshActivityFocusStatusBar } from './focus-activity';

/**
 * True only when every content change in the event is a pure insertion of
 * whitespace (no characters deleted, inserted text is whitespace only). The
 * deletion case is intentionally not detected — we only have the post-change
 * document and verifying that the removed text was whitespace would require
 * remembering the prior state. The pure-addition heuristic catches the most
 * common keystroke pattern (typing spaces / newlines) without false positives.
 */
export function isWhitespaceOnlyChange(event: vscode.TextDocumentChangeEvent): boolean {
    if (event.contentChanges.length === 0) { return false; }
    return event.contentChanges.every(c => c.rangeLength === 0 && /^\s*$/.test(c.text));
}

/**
 * Apply all decorations and status-bar refreshes to the active editor at
 * activation time, then subscribe to editor/document/config events so the
 * UI stays in sync as the user navigates and edits.
 */
export function registerEditorUiEvents(context: vscode.ExtensionContext): void {
    // Tag, date, mention, and dim decorations. Each decoration type is layered
    // additively — order matters for clarity but VSCode applies them all.
    if (vscode.window.activeTextEditor) {
        updateTagDecorations(vscode.window.activeTextEditor);
        updateDateDecorations(vscode.window.activeTextEditor);
        updateMentionDecorations(vscode.window.activeTextEditor);
        updateDimDecorations(vscode.window.activeTextEditor);
        refreshFocusStatusBar(vscode.window.activeTextEditor);
        refreshFocusTagStatusBar(vscode.window.activeTextEditor);
        refreshActivityFocusStatusBar(vscode.window.activeTextEditor);
    }

    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(editor => {
            if (editor) {
                updateTagDecorations(editor);
                updateDateDecorations(editor);
                updateMentionDecorations(editor);
                updateDimDecorations(editor);
            }
            refreshFocusStatusBar(editor);
            refreshFocusTagStatusBar(editor);
            refreshActivityFocusStatusBar(editor);
        }),
        vscode.workspace.onDidChangeTextDocument(event => {
            const editor = vscode.window.activeTextEditor;
            if (!editor || event.document !== editor.document) { return; }
            // Whitespace-only insertions cannot change parsed tags, mentions,
            // dates, user defs, or section structure — skip the decoration and
            // status-bar work entirely.
            if (isWhitespaceOnlyChange(event)) { return; }
            updateTagDecorations(editor);
            updateDateDecorations(editor);
            updateMentionDecorations(editor);
            updateDimDecorations(editor);
            // Status bar tooltip depends on parsed user defs — refresh too.
            refreshFocusStatusBar(editor);
            refreshFocusTagStatusBar(editor);
            refreshActivityFocusStatusBar(editor);
        }),
        vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration('mdTodo.dateOpacity')) {
                createDateDecorationType();
                const editor = vscode.window.activeTextEditor;
                if (editor) {
                    updateDateDecorations(editor);
                }
            }
        })
    );
}
