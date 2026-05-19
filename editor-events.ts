import * as vscode from 'vscode';
import { updateTagDecorations } from './decoration-tag';
import { createDateDecorationType, updateDateDecorations } from './decoration-date';
import { updateMentionDecorations } from './decoration-mention';
import { updateDimDecorations } from './decoration-dim';
import { refreshFocusStatusBar } from './focus-user';
import { refreshFocusTagStatusBar } from './focus-tag';
import { refreshActivityFocusStatusBar } from './focus-activity';

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
            if (editor && event.document === editor.document) {
                updateTagDecorations(editor);
                updateDateDecorations(editor);
                updateMentionDecorations(editor);
                updateDimDecorations(editor);
                // Status bar tooltip depends on parsed user defs — refresh too.
                refreshFocusStatusBar(editor);
                refreshFocusTagStatusBar(editor);
                refreshActivityFocusStatusBar(editor);
            }
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
