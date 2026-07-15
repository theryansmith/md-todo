import * as vscode from 'vscode';
import { isTodoFile, parseDocument } from '../../vscode/document-cache';
import { requireTodoEditor } from '../../vscode/guards';
import { getFocusTag, setFocusTagState } from '../../vscode/state';
import { updateDimDecorations } from './decoration-dim';

export async function clearFocusTag(): Promise<void> {
    await setFocusTagState(undefined);
    for (const visible of vscode.window.visibleTextEditors) {
        if (isTodoFile(visible.document)) {
            updateDimDecorations(visible);
        }
    }
    refreshFocusTagStatusBar(vscode.window.activeTextEditor);
}

let tagFocusStatusBarItem: vscode.StatusBarItem | undefined;

export function initFocusTagStatusBar(context: vscode.ExtensionContext): void {
    // Tag-focus status bar (priority 99 so user-focus at 100 sits to its right).
    tagFocusStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
    tagFocusStatusBarItem.command = 'mdTodo.setFocusTag';
    context.subscriptions.push(tagFocusStatusBarItem);
}

export function refreshFocusTagStatusBar(editor: vscode.TextEditor | undefined) {
    if (!tagFocusStatusBarItem) {
        return;
    }
    if (!editor || !isTodoFile(editor.document)) {
        tagFocusStatusBarItem.hide();
        return;
    }
    const focus = getFocusTag();
    if (!focus) {
        tagFocusStatusBarItem.text = '$(tag) All tags';
        tagFocusStatusBarItem.tooltip = 'No tag focus — click to focus on a tag';
    } else {
        tagFocusStatusBarItem.text = `$(tag) #${focus}`;
        tagFocusStatusBarItem.tooltip = `Focused on #${focus} — click to change`;
    }
    tagFocusStatusBarItem.show();
}

export async function setFocusTag(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage('Open a todo file first');
        return;
    }
    const ctx = requireTodoEditor(editor);
    if (!ctx) {
        return;
    }
    const parsed = parseDocument(ctx.document);

    type TagPick = vscode.QuickPickItem & { tagname: string | undefined };
    const picks: TagPick[] = [
        { label: '$(circle-slash) Clear focus', description: 'Show all tags', tagname: undefined },
        ...[...parsed.tagDefinitions]
            .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
            .map<TagPick>((t) => ({
                label: `$(tag) #${t.name}`,
                detail: t.description,
                tagname: t.name,
            })),
    ];

    if (parsed.tagDefinitions.length === 0) {
        vscode.window.showInformationMessage('No tags defined. Add a "## Tags" section first.');
    }

    const current = getFocusTag();
    const placeHolder = current
        ? `Currently focused on #${current}`
        : 'Select a tag to focus on (or clear)';
    const picked = await vscode.window.showQuickPick(picks, {
        placeHolder,
        matchOnDescription: true,
        matchOnDetail: true,
    });
    if (!picked) {
        return;
    }

    await setFocusTagState(picked.tagname);
    for (const visible of vscode.window.visibleTextEditors) {
        if (isTodoFile(visible.document)) {
            updateDimDecorations(visible);
        }
    }
    refreshFocusTagStatusBar(vscode.window.activeTextEditor);
}
