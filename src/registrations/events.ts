import * as vscode from 'vscode';
import { DecorationController } from '../vscode/decoration-controller';
import { tagDecoration } from '../features/decorations/decoration-tag';
import { dateDecoration } from '../features/decorations/decoration-date';
import { mentionDecoration } from '../features/decorations/decoration-mention';
import { projectDecoration } from '../features/decorations/decoration-project';
import { dimDecoration } from '../features/focus/decoration-dim';
import { refreshFocusStatusBar } from '../features/focus/focus-user';
import { refreshFocusTagStatusBar } from '../features/focus/focus-tag';
import { refreshFocusProjectStatusBar } from '../features/focus/focus-project';
import { refreshActivityFocusStatusBar } from '../features/focus/focus-activity';

// Each decoration type is layered additively — the historical tag → date →
// mention → project → dim order is preserved for clarity; VS Code applies
// them all. Adding a decoration dimension now means adding a descriptor to
// this list, not cloning a module.
const decorationControllers: readonly DecorationController[] = [
    tagDecoration,
    dateDecoration,
    mentionDecoration,
    projectDecoration,
    dimDecoration,
];

const statusBarRefreshers: readonly ((editor: vscode.TextEditor | undefined) => void)[] = [
    refreshFocusStatusBar,
    refreshFocusTagStatusBar,
    refreshFocusProjectStatusBar,
    refreshActivityFocusStatusBar,
];

/**
 * True only when every content change in the event is a pure insertion of
 * whitespace (no characters deleted, inserted text is whitespace only). The
 * deletion case is intentionally not detected — we only have the post-change
 * document and verifying that the removed text was whitespace would require
 * remembering the prior state. The pure-addition heuristic catches the most
 * common keystroke pattern (typing spaces / newlines) without false positives.
 */
export function isWhitespaceOnlyChange(event: vscode.TextDocumentChangeEvent): boolean {
    if (event.contentChanges.length === 0) {
        return false;
    }
    return event.contentChanges.every((c) => c.rangeLength === 0 && /^\s*$/.test(c.text));
}

/**
 * Apply all decorations and status-bar refreshes to the active editor at
 * activation time, then subscribe to editor/document/config events so the
 * UI stays in sync as the user navigates and edits.
 */
export function registerEditorUiEvents(context: vscode.ExtensionContext): void {
    // The controllers own the TextEditorDecorationType singletons and per-URI
    // caches — dispose them with the extension (F-12).
    context.subscriptions.push(...decorationControllers);

    const initialEditor = vscode.window.activeTextEditor;
    if (initialEditor) {
        for (const controller of decorationControllers) {
            controller.update(initialEditor);
        }
        for (const refresh of statusBarRefreshers) {
            refresh(initialEditor);
        }
    }

    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor((editor) => {
            if (editor) {
                for (const controller of decorationControllers) {
                    controller.update(editor);
                }
            }
            for (const refresh of statusBarRefreshers) {
                refresh(editor);
            }
        }),
        vscode.workspace.onDidChangeTextDocument((event) => {
            const editor = vscode.window.activeTextEditor;
            if (event.document !== editor?.document) {
                return;
            }
            // Whitespace-only insertions cannot change parsed tags, mentions,
            // dates, user defs, or section structure — skip the decoration and
            // status-bar work entirely.
            if (isWhitespaceOnlyChange(event)) {
                return;
            }
            // Document edit: route through the incremental decoration path so
            // each controller shifts its cached options past the edit and
            // re-scans only the affected line range instead of the whole
            // document. Initial open / editor switch still uses the full-scan
            // path above — that's where the per-URI caches get populated.
            for (const controller of decorationControllers) {
                controller.updateIncremental(editor, event.contentChanges);
            }
            // Status bar tooltip depends on parsed user defs — refresh too.
            for (const refresh of statusBarRefreshers) {
                refresh(editor);
            }
        }),
        vscode.workspace.onDidChangeConfiguration((event) => {
            for (const controller of decorationControllers) {
                if (controller.affectsConfiguration(event)) {
                    controller.recreateType();
                    const editor = vscode.window.activeTextEditor;
                    if (editor) {
                        controller.update(editor);
                    }
                }
            }
        })
    );
}
