import * as vscode from 'vscode';
import { isTodoFile, parseDocument, getEffectiveEditor } from '../../core/parser';
import { getFocusUser, setFocusUserState } from '../../vscode/state';
import { updateDimDecorations } from './decoration-dim';

export async function clearFocusUser(): Promise<void> {
    await setFocusUserState(undefined);
    for (const visible of vscode.window.visibleTextEditors) {
        if (isTodoFile(visible.document)) {
            updateDimDecorations(visible);
        }
    }
    refreshFocusStatusBar(vscode.window.activeTextEditor);
}

let focusStatusBarItem: vscode.StatusBarItem | undefined;

export function initFocusUserStatusBar(context: vscode.ExtensionContext): void {
    focusStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    focusStatusBarItem.command = 'mdTodo.setFocusUser';
    context.subscriptions.push(focusStatusBarItem);
}

export function refreshFocusStatusBar(editor: vscode.TextEditor | undefined) {
    if (!focusStatusBarItem) {
        return;
    }

    if (!editor || !isTodoFile(editor.document)) {
        focusStatusBarItem.hide();
        return;
    }

    const focus = getFocusUser();
    if (!focus) {
        focusStatusBarItem.text = '$(person) All users';
        focusStatusBarItem.tooltip = 'No user focus — click to focus on a user';
    } else {
        const parsed = parseDocument(editor.document);
        const userDef = parsed.userDefinitions.find((u) => u.shortname === focus);
        const display = userDef?.fullname || focus;
        focusStatusBarItem.text = `$(person) @${focus}`;
        focusStatusBarItem.tooltip = `Focused on ${display} — click to change`;
    }
    focusStatusBarItem.show();
}

export async function setFocusUser(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage('Open a todo file first');
        return;
    }
    const ctx = await getEffectiveEditor(editor);
    if (!isTodoFile(ctx.document)) {
        vscode.window.showWarningMessage(
            'Not a todo file. Add "md-todo: true" to YAML frontmatter.'
        );
        return;
    }

    const parsed = parseDocument(ctx.document);

    type FocusPick = vscode.QuickPickItem & { shortname: string | undefined };
    const picks: FocusPick[] = [
        {
            label: '$(circle-slash) Clear focus',
            description: 'Show all users',
            shortname: undefined,
        },
        ...[...parsed.userDefinitions]
            .sort((a, b) =>
                a.shortname.localeCompare(b.shortname, undefined, { sensitivity: 'base' })
            )
            .map<FocusPick>((u) => ({
                label: `$(person) @${u.shortname}`,
                description: u.fullname,
                detail: u.description,
                shortname: u.shortname,
            })),
    ];

    if (parsed.userDefinitions.length === 0) {
        vscode.window.showInformationMessage('No users defined. Add a "## Users" section first.');
    }

    const current = getFocusUser();
    const placeHolder = current
        ? `Currently focused on @${current}`
        : 'Select a user to focus on (or clear)';

    const picked = await vscode.window.showQuickPick(picks, {
        placeHolder,
        matchOnDescription: true,
        matchOnDetail: true,
    });
    if (!picked) {
        return;
    }

    await setFocusUserState(picked.shortname);

    for (const visible of vscode.window.visibleTextEditors) {
        if (isTodoFile(visible.document)) {
            updateDimDecorations(visible);
        }
    }
    refreshFocusStatusBar(vscode.window.activeTextEditor);
}
