import * as vscode from 'vscode';
import { isTodoFile } from '../../core/parser';
import { getToday } from '../../core/dates';

/**
 * Register a text-document change listener that auto-appends `+YYYY-MM-DD`
 * to newly typed todo / note lines when the user presses Enter. The handler
 * guards against re-entry via a module-local flag because the edit it makes
 * triggers the same listener.
 */
export function registerAutoDateHandler(context: vscode.ExtensionContext): void {
    let isAutoAddingDate = false;

    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument(async (event) => {
            if (isAutoAddingDate) {
                return;
            }

            const editor = vscode.window.activeTextEditor;
            if (event.document !== editor?.document) {
                return;
            }
            if (!isTodoFile(event.document)) {
                return;
            }

            for (const change of event.contentChanges) {
                if (!change.text.includes('\n')) {
                    continue;
                }

                const lineBeforeNum = change.range.start.line;
                if (lineBeforeNum < 0 || lineBeforeNum >= event.document.lineCount) {
                    continue;
                }

                const lineBefore = event.document.lineAt(lineBeforeNum).text;
                const today = getToday();
                const datePattern = /`\+\d{4}-\d{2}-\d{2}`/;

                const noteMatch = /^(\s+)-\s+(?!\[[ xX]\])(.+)$/.exec(lineBefore);
                if (noteMatch && !datePattern.test(lineBefore)) {
                    const existingText = noteMatch[2].trim();
                    if (existingText && existingText.length > 0) {
                        isAutoAddingDate = true;
                        try {
                            const lineRange = event.document.lineAt(lineBeforeNum).range;
                            const indent = noteMatch[1];
                            const newText = `${indent}- ${existingText} \`+${today}\``;
                            await editor.edit(
                                (editBuilder) => {
                                    editBuilder.replace(lineRange, newText);
                                },
                                { undoStopBefore: false, undoStopAfter: false }
                            );
                        } finally {
                            isAutoAddingDate = false;
                        }
                    }
                    continue;
                }

                const todoMatch = /^(\s*)-\s*\[([ xX])\]\s*(.+)$/.exec(lineBefore);
                if (todoMatch && !datePattern.test(lineBefore)) {
                    const existingText = todoMatch[3].trim();
                    if (existingText && existingText.length > 0) {
                        isAutoAddingDate = true;
                        try {
                            const lineRange = event.document.lineAt(lineBeforeNum).range;
                            const indent = todoMatch[1];
                            const checkbox = todoMatch[2];
                            const newText = `${indent}- [${checkbox}] ${existingText} \`+${today}\``;
                            await editor.edit(
                                (editBuilder) => {
                                    editBuilder.replace(lineRange, newText);
                                },
                                { undoStopBefore: false, undoStopAfter: false }
                            );
                        } finally {
                            isAutoAddingDate = false;
                        }
                    }
                }
            }
        })
    );
}
