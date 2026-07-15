import * as vscode from 'vscode';
import { parseDocument } from '../../vscode/document-cache';
import { requireTodoEditor } from '../../vscode/guards';
import { getToday } from '../../core/dates';
import { promptForTodoText } from '../../vscode/prompts';

export async function addItem(editor: vscode.TextEditor) {
    const ctx = requireTodoEditor(editor);
    if (!ctx) {
        return;
    }
    const effectiveEditor = ctx.editor;
    const effectiveDocument = ctx.document;

    const text = await promptForTodoText(effectiveDocument, {
        prompt: 'Enter todo item',
        placeHolder: 'What needs to be done? (type @ or # for suggestions)',
    });

    if (!text) {
        return;
    }

    const today = getToday();
    const newLine = `- [ ] ${text} \`+${today}\``;

    const parsed = parseDocument(effectiveDocument);

    const activeSection = parsed.sections.get('active');
    let insertLine: number;

    if (activeSection) {
        insertLine = activeSection.start + 1;
    } else {
        insertLine = 0;
        for (let i = 0; i < effectiveDocument.lineCount; i++) {
            if (effectiveDocument.lineAt(i).text.startsWith('## ')) {
                insertLine = i + 1;
                break;
            }
        }
    }

    while (
        insertLine < effectiveDocument.lineCount &&
        effectiveDocument.lineAt(insertLine).text.trim() === ''
    ) {
        insertLine++;
    }

    await effectiveEditor.edit((editBuilder: vscode.TextEditorEdit) => {
        editBuilder.insert(new vscode.Position(insertLine, 0), newLine + '\n');
    });

    vscode.window.showInformationMessage(`Added: ${text}`);
}
