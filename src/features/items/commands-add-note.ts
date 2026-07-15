import * as vscode from 'vscode';
import { TodoItem } from '../../core/model';
import {
    isTodoFile,
    parseDocument,
    findItemAtCursor,
    getEffectiveEditor,
    getItemEndLine,
} from '../../core/parse/parser';
import { getToday } from '../../core/dates';
import { promptForTodoText } from '../../vscode/prompts';

export async function addNote(editor: vscode.TextEditor) {
    const ctx = await getEffectiveEditor(editor);
    const effectiveEditor = ctx.editor;
    const effectiveDocument = ctx.document;

    if (!isTodoFile(effectiveDocument)) {
        vscode.window.showWarningMessage(
            'Not a todo file. Add "md-todo: true" to YAML frontmatter.'
        );
        return;
    }

    const result = findItemAtCursor(effectiveEditor);

    if (!result) {
        const parsed = parseDocument(effectiveDocument);

        if (parsed.items.length === 0) {
            vscode.window.showInformationMessage('No todo items found');
            return;
        }

        const picks = parsed.items.map((item) => ({
            label: `${item.isComplete ? '✓' : '○'} ${item.text}`,
            description: item.notes.length > 0 ? `${item.notes.length} notes` : '',
            item,
        }));

        const selected = await vscode.window.showQuickPick(picks, {
            placeHolder: 'Select item to add note',
        });

        if (!selected) {
            return;
        }

        await addNoteToItem(effectiveEditor, selected.item);
    } else {
        await addNoteToItem(effectiveEditor, result.item);
    }
}

async function addNoteToItem(editor: vscode.TextEditor, item: TodoItem) {
    const note = await promptForTodoText(editor.document, {
        prompt: `Add note to: ${item.text}`,
        placeHolder: 'Progress update... (type @ or # for suggestions)',
    });

    if (!note) {
        return;
    }

    const document = editor.document;
    const today = getToday();
    const endLine = getItemEndLine(document, item.line);
    // Note indent = item's indent + 2 spaces (relative to parent todo)
    const indent = ' '.repeat(item.indent + 2);
    const noteLine = `${indent}- ${note} \`+${today}\``;

    await editor.edit((editBuilder: vscode.TextEditorEdit) => {
        const insertPosition = new vscode.Position(endLine + 1, 0);
        editBuilder.insert(insertPosition, noteLine + '\n');
    });

    vscode.window.showInformationMessage('Note added');
}
