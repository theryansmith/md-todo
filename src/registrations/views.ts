import * as vscode from 'vscode';
import { GroupingTreeProvider } from '../vscode/grouping-tree';
import { isTodoFile } from '../vscode/document-cache';
import { rememberLastTodoUri } from '../vscode/state';
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

    context.subscriptions.push(
        vscode.commands.registerCommand('mdTodo.users.focusOnUser', (node?: UsersTreeNode) =>
            focusOnUserFromTree(node)
        ),
        vscode.commands.registerCommand('mdTodo.users.clearFocus', clearUserFocusFromTree),
        vscode.commands.registerCommand('mdTodo.users.reassignUser', (node?: UsersTreeNode) =>
            reassignUserFromTree(usersProvider, node)
        ),
        vscode.commands.registerCommand('mdTodo.users.markDoneFromTree', (node?: UsersTreeNode) =>
            markDoneFromTreeNode(usersProvider, node)
        ),
        vscode.commands.registerCommand('mdTodo.tags.focusOnTag', (node?: TagsTreeNode) =>
            focusOnTagFromTree(node)
        ),
        vscode.commands.registerCommand('mdTodo.tags.clearFocus', clearTagFocusFromTree),
        vscode.commands.registerCommand('mdTodo.tags.markDoneFromTree', (node?: TagsTreeNode) =>
            markDoneFromTreeNode(tagsProvider, node)
        ),
        vscode.commands.registerCommand('mdTodo.tags.editTagsFromTree', (node?: TagsTreeNode) =>
            editTagsFromTree(node)
        ),
        vscode.commands.registerCommand(
            'mdTodo.projects.focusOnProject',
            (node?: ProjectsTreeNode) => focusOnProjectFromTree(node)
        ),
        vscode.commands.registerCommand('mdTodo.projects.clearFocus', clearProjectFocusFromTree),
        vscode.commands.registerCommand(
            'mdTodo.projects.markDoneFromTree',
            (node?: ProjectsTreeNode) => markDoneFromTreeNode(projectsProvider, node)
        ),
        vscode.commands.registerCommand(
            'mdTodo.projects.setProjectFromTree',
            (node?: ProjectsTreeNode) => setProjectFromTree(node)
        ),
        vscode.commands.registerCommand(
            'mdTodo.projects.showProjectViewFromTree',
            (node?: ProjectsTreeNode) => showProjectViewFromTree(node)
        )
    );
}
