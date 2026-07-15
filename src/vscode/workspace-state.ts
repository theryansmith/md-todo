import * as vscode from 'vscode';
import { ActivityFocus } from '../core/model';
import { isTodoFile } from './document-cache';

/**
 * Typed workspaceState access (replaces the old state.ts free-form
 * getter/setter pairs). A StateKey<T> binds the persisted key string to the
 * value type stored under it; getWorkspaceState/updateWorkspaceState are the
 * only readers and writers, so a key can never be read at one type and
 * written at another. The grouping trees' per-view `lastTodoFileUri` keys are
 * not listed here — the providers receive a Memento at construction and
 * derive their keys from the descriptor id (vscode/grouping-tree.ts).
 */
export interface StateKey<T> {
    readonly key: string;
    /** Phantom marker binding T to the key — never present at runtime. */
    readonly __valueType?: T;
}

function stateKey<T>(key: string): StateKey<T> {
    return { key };
}

export const FOCUS_USER_STATE_KEY = stateKey<string>('mdTodo.focusUser');
export const FOCUS_TAG_STATE_KEY = stateKey<string>('mdTodo.focusTag');
export const FOCUS_PROJECT_STATE_KEY = stateKey<string>('mdTodo.focusProject');
export const ACTIVITY_FOCUS_STATE_KEY = stateKey<ActivityFocus>('mdTodo.activityFocus');
export const LAST_TODO_URI_STATE_KEY = stateKey<string>('mdTodo.completion.lastTodoFileUri');

// THE one host-lifecycle concession to a module-level singleton: workspace
// state hangs off the ExtensionContext, which only exists once activate()
// has run, yet it is read from command handlers, decoration scans, and
// completion providers that would otherwise all need the context threaded
// through their signatures. activate() sets it exactly once; everything else
// reaches it through the typed helpers below. Contained here by design — no
// other module may hold the ExtensionContext (enterprise-restructure TDD,
// Phase 3d).
let extensionContext: vscode.ExtensionContext | undefined;

export function setExtensionContext(ctx: vscode.ExtensionContext): void {
    extensionContext = ctx;
}

/** Read a typed workspaceState value; undefined before activation or when unset. */
export function getWorkspaceState<T>(key: StateKey<T>): T | undefined {
    return extensionContext?.workspaceState.get<T>(key.key);
}

/** Write (or, with undefined, clear) a typed workspaceState value. */
export async function updateWorkspaceState<T>(
    key: StateKey<T>,
    value: T | undefined
): Promise<void> {
    if (!extensionContext) {
        return;
    }
    await extensionContext.workspaceState.update(key.key, value);
}

// Records the URI of the most recently active mdtodo document so that
// completion providers can source tags/users from it even when the
// active editor is a non-mdtodo file.
let lastTodoUri: vscode.Uri | undefined;

export function rememberLastTodoUri(uri: vscode.Uri): void {
    lastTodoUri = uri;
    void updateWorkspaceState(LAST_TODO_URI_STATE_KEY, uri.toString());
}

export async function getLastTodoSourceDoc(): Promise<vscode.TextDocument | undefined> {
    let uri = lastTodoUri;
    if (!uri) {
        const stored = getWorkspaceState(LAST_TODO_URI_STATE_KEY);
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
