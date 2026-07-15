import * as vscode from 'vscode';
import { isTodoFile, parseDocument, getEffectiveEditor } from './parser';
import { addUserDefinition } from './prompts';

export async function addUser(editor: vscode.TextEditor) {
    const ctx = await getEffectiveEditor(editor);
    const effectiveEditor = ctx.editor;
    const effectiveDocument = ctx.document;

    if (!isTodoFile(effectiveDocument)) {
        vscode.window.showWarningMessage(
            'Not a todo file. Add "md-todo: true" to YAML frontmatter.'
        );
        return;
    }

    const parsed = parseDocument(effectiveDocument);

    const shortname = await vscode.window.showInputBox({
        prompt: 'User shortname (used as @shortname)',
        placeHolder: 'e.g. asmith',
        validateInput: (value) => {
            if (!value) {
                return 'Required';
            }
            if (!/^[\w-]+$/.exec(value)) {
                return 'Letters, digits, _ and - only';
            }
            if (parsed.userDefinitions.some((u) => u.shortname === value)) {
                return `User @${value} already defined`;
            }
            return null;
        },
    });
    if (!shortname) {
        return;
    }

    const fullname = await vscode.window.showInputBox({
        prompt: 'Full name (optional)',
        placeHolder: 'e.g. Alice Smith',
    });
    if (fullname === undefined) {
        return;
    }

    const description = await vscode.window.showInputBox({
        prompt: 'Description',
        placeHolder: 'e.g. frontend lead',
        validateInput: (value) => (value ? null : 'Required'),
    });
    if (!description) {
        return;
    }

    const fullnamePart = fullname.trim() ? ` (${fullname.trim()})` : '';
    const newLine = `**${shortname}**${fullnamePart}: ${description}`;
    await addUserDefinition(effectiveEditor, shortname, newLine);
}
