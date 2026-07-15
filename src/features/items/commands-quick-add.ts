import * as vscode from 'vscode';
import { isTodoFile, getEffectiveEditor } from '../../core/parser';
import { getToday } from '../../core/dates';

export async function quickAdd(editor: vscode.TextEditor) {
    const ctx = await getEffectiveEditor(editor);
    const effectiveEditor = ctx.editor;

    if (!isTodoFile(ctx.document)) {
        vscode.window.showWarningMessage(
            'Not a todo file. Add "md-todo: true" to YAML frontmatter.'
        );
        return;
    }

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
