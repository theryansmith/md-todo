import * as vscode from 'vscode';
import { ActivityFocus } from '../core/types';
import { isTodoFile } from '../core/parser';

export const FOCUS_USER_STATE_KEY = 'mdTodo.focusUser';
export const FOCUS_TAG_STATE_KEY = 'mdTodo.focusTag';
export const FOCUS_PROJECT_STATE_KEY = 'mdTodo.focusProject';
export const ACTIVITY_FOCUS_STATE_KEY = 'mdTodo.activityFocus';
export const LAST_TODO_URI_STATE_KEY = 'mdTodo.completion.lastTodoFileUri';

// Module-level reference so commands and event handlers can read/write the
// per-workspace focus user without threading context everywhere.
let extensionContext: vscode.ExtensionContext | undefined;

export function setExtensionContext(ctx: vscode.ExtensionContext): void {
    extensionContext = ctx;
}

export function getExtensionContext(): vscode.ExtensionContext | undefined {
    return extensionContext;
}

export function getFocusUser(): string | undefined {
    return extensionContext?.workspaceState.get<string>(FOCUS_USER_STATE_KEY);
}

export async function setFocusUserState(shortname: string | undefined): Promise<void> {
    if (!extensionContext) {
        return;
    }
    await extensionContext.workspaceState.update(FOCUS_USER_STATE_KEY, shortname);
}

export function getFocusTag(): string | undefined {
    return extensionContext?.workspaceState.get<string>(FOCUS_TAG_STATE_KEY);
}

export async function setFocusTagState(tagname: string | undefined): Promise<void> {
    if (!extensionContext) {
        return;
    }
    await extensionContext.workspaceState.update(FOCUS_TAG_STATE_KEY, tagname);
}

export function getFocusProject(): string | undefined {
    return extensionContext?.workspaceState.get<string>(FOCUS_PROJECT_STATE_KEY);
}

export async function setFocusProjectState(name: string | undefined): Promise<void> {
    if (!extensionContext) {
        return;
    }
    await extensionContext.workspaceState.update(FOCUS_PROJECT_STATE_KEY, name);
}

export function getActivityFocus(): ActivityFocus | undefined {
    return extensionContext?.workspaceState.get<ActivityFocus>(ACTIVITY_FOCUS_STATE_KEY);
}

export async function setActivityFocusState(focus: ActivityFocus | undefined): Promise<void> {
    if (!extensionContext) {
        return;
    }
    await extensionContext.workspaceState.update(ACTIVITY_FOCUS_STATE_KEY, focus);
}

// Records the URI of the most recently active mdtodo document so that
// completion providers can source tags/users from it even when the
// active editor is a non-mdtodo file.
let lastTodoUri: vscode.Uri | undefined;

export function rememberLastTodoUri(uri: vscode.Uri): void {
    lastTodoUri = uri;
    extensionContext?.workspaceState.update(LAST_TODO_URI_STATE_KEY, uri.toString());
}

export async function getLastTodoSourceDoc(): Promise<vscode.TextDocument | undefined> {
    let uri = lastTodoUri;
    if (!uri) {
        const stored = extensionContext?.workspaceState.get<string>(LAST_TODO_URI_STATE_KEY);
        if (!stored) {
            return undefined;
        }
        try {
            uri = vscode.Uri.parse(stored);
        } catch {
            return undefined;
        }
        lastTodoUri = uri;
    }
    try {
        const doc = await vscode.workspace.openTextDocument(uri);
        return isTodoFile(doc) ? doc : undefined;
    } catch {
        return undefined;
    }
}
