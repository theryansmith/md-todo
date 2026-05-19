import * as vscode from 'vscode';
import { isTodoFile } from './parser';

let mentionDecorationType: vscode.TextEditorDecorationType | undefined;

export function createMentionDecorationType(): vscode.TextEditorDecorationType {
    if (mentionDecorationType) {
        mentionDecorationType.dispose();
    }
    // Distinct styling from tag decorations: bold + accent color (charts.blue)
    mentionDecorationType = vscode.window.createTextEditorDecorationType({
        color: new vscode.ThemeColor('charts.blue'),
        fontWeight: 'bold'
    });
    return mentionDecorationType;
}

export function updateMentionDecorations(editor: vscode.TextEditor) {
    const decorationType = mentionDecorationType ?? createMentionDecorationType();

    if (!isTodoFile(editor.document)) {
        editor.setDecorations(decorationType, []);
        return;
    }

    const decorations: vscode.DecorationOptions[] = [];
    for (let i = 0; i < editor.document.lineCount; i++) {
        const line = editor.document.lineAt(i);
        const matches = [...line.text.matchAll(/@[\w-]+/g)];
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
