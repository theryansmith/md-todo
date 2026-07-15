import * as vscode from 'vscode';
import { requireTodoEditor } from '../../vscode/guards';
import { getToday } from '../../core/dates';

export async function quickAdd(editor: vscode.TextEditor) {
    const ctx = requireTodoEditor(editor);
    if (!ctx) {
        return;
    }
    const effectiveEditor = ctx.editor;

    const today = getToday();
    const cursorPos = effectiveEditor.selection.active;

    const text = `- [ ]  \`+${today}\``;

    await effectiveEditor.edit((editBuilder: vscode.TextEditorEdit) => {
        editBuilder.insert(cursorPos, text);
    });

    // Move cursor to between ] and backtick for typing
    const newPos = new vscode.Position(cursorPos.line, cursorPos.character + 6);
    effectiveEditor.selection = new vscode.Selection(newPos, newPos);
}
