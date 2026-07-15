import * as vscode from 'vscode';
import { isTodoFile, parseDocument, getEffectiveEditor } from '../../core/parser';
import { getToday } from '../../core/dates';
import { promptForTodoText } from '../../vscode/prompts';

export async function addItem(editor: vscode.TextEditor) {
    const ctx = await getEffectiveEditor(editor);
    const effectiveEditor = ctx.editor;
    const effectiveDocument = ctx.document;

    if (!isTodoFile(effectiveDocument)) {
        vscode.window.showWarningMessage(
            'Not a todo file. Add "md-todo: true" to YAML frontmatter.'
        );
        return;
    }

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
