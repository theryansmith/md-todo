import * as vscode from 'vscode';
import { parseDocument } from '../../vscode/document-cache';
import { requireTodoEditor } from '../../vscode/guards';
import { userFocus } from '../focus/focus-user';

/**
 * Toggle `@<shortname>` on the current todo line at the cursor.
 * - If focus is set, use the focused user (no quick pick).
 * - If focus is unset, prompt with a quick pick.
 * - REMOVE if the line already contains `@<shortname>` (whole-word).
 * - Otherwise INSERT at the cursor with surrounding whitespace as needed.
 */
export async function assignFocusedUser(editor: vscode.TextEditor): Promise<void> {
    const ctx = requireTodoEditor(editor);
    if (!ctx) {
        return;
    }
    const document = ctx.document;
    const targetEditor = ctx.editor;

    const cursorLine = editor.selection.active.line;
    const cursorChar = editor.selection.active.character;

    const lineText = document.lineAt(cursorLine).text;
    if (!/^\s*-\s*\[[ xX]\]/.test(lineText)) {
        vscode.window.showWarningMessage('Place cursor on a todo line.');
        return;
    }

    let shortname = userFocus.get();
    if (!shortname) {
        const parsed = parseDocument(document);
        if (parsed.userDefinitions.length === 0) {
            vscode.window.showInformationMessage(
                'No users defined. Add a "## Users" section first.'
            );
            return;
        }
        type UserPick = vscode.QuickPickItem & { shortname: string };
        const picks: UserPick[] = [...parsed.userDefinitions]
            .sort((a, b) =>
                a.shortname.localeCompare(b.shortname, undefined, { sensitivity: 'base' })
            )
            .map((u) => ({
                label: `$(person) @${u.shortname}`,
                description: u.fullname,
                detail: u.description,
                shortname: u.shortname,
            }));
        const picked = await vscode.window.showQuickPick(picks, {
            placeHolder: 'Select user to assign',
            matchOnDescription: true,
            matchOnDetail: true,
        });
        if (!picked) {
            return;
        }
        shortname = picked.shortname;
    }

    const mentionToken = `@${shortname}`;

    const wholeWordRe = new RegExp(`@${shortname}(?![\\w-])`, 'g');
    if (wholeWordRe.test(lineText)) {
        let newText = lineText.replace(wholeWordRe, '');
        const leading = /^\s*/.exec(newText)?.[0] ?? '';
        newText =
            leading + newText.slice(leading.length).replace(/ {2,}/g, ' ').replace(/\s+$/, '');
        const lineRange = document.lineAt(cursorLine).range;
        await targetEditor.edit((eb) => {
            eb.replace(lineRange, newText);
        });
        return;
    }

    const insertCol = Math.min(cursorChar, lineText.length);
    const prevChar = insertCol > 0 ? lineText.charAt(insertCol - 1) : '';
    const nextChar = insertCol < lineText.length ? lineText.charAt(insertCol) : '';
    let insertText = mentionToken;
    if (prevChar && !/\s/.test(prevChar) && prevChar !== '@') {
        insertText = ' ' + insertText;
    }
    if (nextChar && !/\s/.test(nextChar)) {
        insertText = insertText + ' ';
    }
    await targetEditor.edit((eb) => {
        eb.insert(new vscode.Position(cursorLine, insertCol), insertText);
    });
}
