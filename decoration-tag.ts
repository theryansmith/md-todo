import * as vscode from 'vscode';
import { isTodoFile } from './parser';

let tagDecorationType: vscode.TextEditorDecorationType | undefined;

export function createTagDecorationType(): vscode.TextEditorDecorationType {
    if (tagDecorationType) {
        tagDecorationType.dispose();
    }

    // Distinct, visible color for tags (purple). Less prominent than @mentions
    // (which are bold + charts.blue), but clearly stands out from body text.
    tagDecorationType = vscode.window.createTextEditorDecorationType({
        color: new vscode.ThemeColor('charts.purple')
    });

    return tagDecorationType;
}

export function updateTagDecorations(editor: vscode.TextEditor) {
    const decorationType = tagDecorationType ?? createTagDecorationType();

    if (!isTodoFile(editor.document)) {
        editor.setDecorations(decorationType, []);
        return;
    }

    const decorations: vscode.DecorationOptions[] = [];

    for (let i = 0; i < editor.document.lineCount; i++) {
        const line = editor.document.lineAt(i);
        const matches = [...line.text.matchAll(/#[\w-]+/g)];

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
