import * as vscode from 'vscode';
import { GroupingTreeProvider } from '../vscode/grouping-tree';
import { isTodoFile } from '../vscode/document-cache';
import { rememberLastTodoUri } from '../vscode/workspace-state';
import { markDoneFromTreeNode } from '../features/tree-commands';
import {
    usersGrouping,
    UsersTreeNode,
    focusOnUserFromTree,
    clearUserFocusFromTree,
    reassignUserFromTree,
} from '../features/users/tree-users';
import {
    tagsGrouping,
    TagsTreeNode,
    focusOnTagFromTree,
    clearTagFocusFromTree,
    editTagsFromTree,
} from '../features/tags/tree-tags';
import {
    projectsGrouping,
    ProjectsTreeNode,
    focusOnProjectFromTree,
    clearProjectFocusFromTree,
    setProjectFromTree,
    showProjectViewFromTree,
} from '../features/projects/tree-projects';
import { isWhitespaceOnlyChange } from './events';

/**
 * Every tree context-menu command ID registered by registerTreeViews() —
 * frozen (referenced from package.json contributes.menus) and exported for
 * the package.json ↔ registration consistency test. The handler record in
 * registerTreeViews is keyed by this list, so TypeScript guarantees the two
 * cannot drift: an id here without a handler (or vice versa) fails to
 * compile.
 */
export const treeCommandIds = [
    'mdTodo.users.focusOnUser',
    'mdTodo.users.clearFocus',
    'mdTodo.users.reassignUser',
    'mdTodo.users.markDoneFromTree',
    'mdTodo.tags.focusOnTag',
    'mdTodo.tags.clearFocus',
    'mdTodo.tags.markDoneFromTree',
    'mdTodo.tags.editTagsFromTree',
    'mdTodo.projects.focusOnProject',
    'mdTodo.projects.clearFocus',
    'mdTodo.projects.markDoneFromTree',
    'mdTodo.projects.setProjectFromTree',
    'mdTodo.projects.showProjectViewFromTree',
] as const;
export type TreeCommandId = (typeof treeCommandIds)[number];

/**
 * Create the three grouping-tree providers + views, seed them with the active
 * todo file, subscribe them to editor/document events, and register the
 * tree-driven commands. The Users/Tags/Projects views share one generic
 * provider (vscode/grouping-tree.ts) parameterized by descriptor, so the
 * wiring iterates the provider list instead of repeating itself per tree.
 */
export function registerTreeViews(context: vscode.ExtensionContext): void {
    const usersProvider = new GroupingTreeProvider(usersGrouping, context.workspaceState);
    const tagsProvider = new GroupingTreeProvider(tagsGrouping, context.workspaceState);
    const projectsProvider = new GroupingTreeProvider(projectsGrouping, context.workspaceState);

    const providers = [usersProvider, tagsProvider, projectsProvider];

    // The providers are Disposables too: disposing one cancels any pending
    // debounced-refresh timer (the pre-3c providers leaked theirs).
    context.subscriptions.push(
        vscode.window.createTreeView('mdTodoUsers', { treeDataProvider: usersProvider }),
        vscode.window.createTreeView('mdTodoTags', { treeDataProvider: tagsProvider }),
        vscode.window.createTreeView('mdTodoProjects', { treeDataProvider: projectsProvider }),
        ...providers
    );

    const setCurrentTodoFileAll = (uri: vscode.Uri) => {
        for (const provider of providers) {
            provider.setCurrentTodoFile(uri);
        }
        rememberLastTodoUri(uri);
    };

    const initialEditor = vscode.window.activeTextEditor;
    if (initialEditor && isTodoFile(initialEditor.document)) {
        setCurrentTodoFileAll(initialEditor.document.uri);
    }

    // Track active editor → update the trees' current file when a todo file
    // becomes active. Don't blank out the trees when focus shifts to a
    // non-todo editor (like a tree itself).
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor((editor) => {
            if (editor && isTodoFile(editor.document)) {
                setCurrentTodoFileAll(editor.document.uri);
            }
        }),
        vscode.workspace.onDidChangeTextDocument((event) => {
            if (isWhitespaceOnlyChange(event)) {
                return;
            }
            for (const provider of providers) {
                if (event.document.uri.toString() === provider.getCurrentUri()?.toString()) {
                    provider.refreshDebounced();
                }
            }
        }),
        vscode.workspace.onDidSaveTextDocument((doc) => {
            for (const provider of providers) {
                if (doc.uri.toString() === provider.getCurrentUri()?.toString()) {
                    provider.refresh();
                }
            }
        })
    );

    type TreeCommandHandler = Parameters<typeof vscode.commands.registerCommand>[1];
    const handlers: Record<TreeCommandId, TreeCommandHandler> = {
        'mdTodo.users.focusOnUser': (node?: UsersTreeNode) => focusOnUserFromTree(node),
        'mdTodo.users.clearFocus': clearUserFocusFromTree,
        'mdTodo.users.reassignUser': (node?: UsersTreeNode) =>
            reassignUserFromTree(usersProvider, node),
        'mdTodo.users.markDoneFromTree': (node?: UsersTreeNode) =>
            markDoneFromTreeNode(usersProvider, node),
        'mdTodo.tags.focusOnTag': (node?: TagsTreeNode) => focusOnTagFromTree(node),
        'mdTodo.tags.clearFocus': clearTagFocusFromTree,
        'mdTodo.tags.markDoneFromTree': (node?: TagsTreeNode) =>
            markDoneFromTreeNode(tagsProvider, node),
        'mdTodo.tags.editTagsFromTree': (node?: TagsTreeNode) => editTagsFromTree(node),
        'mdTodo.projects.focusOnProject': (node?: ProjectsTreeNode) => focusOnProjectFromTree(node),
        'mdTodo.projects.clearFocus': clearProjectFocusFromTree,
        'mdTodo.projects.markDoneFromTree': (node?: ProjectsTreeNode) =>
            markDoneFromTreeNode(projectsProvider, node),
        'mdTodo.projects.setProjectFromTree': (node?: ProjectsTreeNode) => setProjectFromTree(node),
        'mdTodo.projects.showProjectViewFromTree': (node?: ProjectsTreeNode) =>
            showProjectViewFromTree(node),
    };

    for (const id of treeCommandIds) {
        context.subscriptions.push(vscode.commands.registerCommand(id, handlers[id]));
    }
}
