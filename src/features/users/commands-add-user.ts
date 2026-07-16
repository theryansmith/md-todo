import * as vscode from 'vscode';
import { parseDocument } from '../../vscode/document-cache';
import { requireTodoEditor } from '../../vscode/guards';
import { addUserDefinition } from '../../vscode/prompts';

export async function addUser(editor: vscode.TextEditor) {
    const ctx = requireTodoEditor(editor);
    if (!ctx) {
        return;
    }
    const effectiveEditor = ctx.editor;
    const effectiveDocument = ctx.document;

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
