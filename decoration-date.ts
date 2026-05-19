import * as vscode from 'vscode';
import { isTodoFile } from './parser';

let dateDecorationType: vscode.TextEditorDecorationType | undefined;

export function createDateDecorationType(): vscode.TextEditorDecorationType {
    const config = vscode.workspace.getConfiguration('mdTodo');
    const opacity = config.get<number>('dateOpacity', 0.5);

    if (dateDecorationType) {
        dateDecorationType.dispose();
    }

    dateDecorationType = vscode.window.createTextEditorDecorationType({
        opacity: String(opacity)
    });

    return dateDecorationType;
}

export function updateDateDecorations(editor: vscode.TextEditor) {
    const decorationType = dateDecorationType ?? createDateDecorationType();

    if (!isTodoFile(editor.document)) {
        editor.setDecorations(decorationType, []);
        return;
    }

    const decorations: vscode.DecorationOptions[] = [];

    const datePattern = /`[+✓]\d{4}-\d{2}-\d{2}`/g;

    for (let i = 0; i < editor.document.lineCount; i++) {
        const line = editor.document.lineAt(i);
        const matches = [...line.text.matchAll(datePattern)];

        for (const match of matches) {
            if (match.index !== undefined) {
                decorations.push({
                    range: new vscode.Range(i, match.index, i, match.index + match[0].length)
                });
            }
        }
    }

    editor.setDecorations(decorationType, decorations);
}
