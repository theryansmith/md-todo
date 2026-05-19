import * as vscode from 'vscode';
import { TreeNode, TagsTreeNode } from './types';
import { isTodoFile } from './parser';
import { rememberLastTodoUri } from './state';
import {
    MdTodoUsersTreeProvider,
    focusOnUserFromTree,
    clearUserFocusFromTree,
    reassignUserFromTree,
    markDoneFromTree,
} from './tree-users';
import {
    MdTodoTagsTreeProvider,
    focusOnTagFromTree,
    clearTagFocusFromTree,
    markDoneFromTagsTree,
    editTagsFromTree,
} from './tree-tags';

/**
 * Create both tree providers + views, seed them with the active todo file,
 * subscribe them to editor/document events, and register the tree-driven
 * commands. Tree-views (Users + Tags) are siblings sharing identical wiring,
 * so they're set up together here.
 */
export function registerTreeViews(context: vscode.ExtensionContext): void {
    const treeProvider = new MdTodoUsersTreeProvider(context.workspaceState);
    const tagsTreeProvider = new MdTodoTagsTreeProvider(context.workspaceState);
    const treeView = vscode.window.createTreeView('mdTodoUsers', { treeDataProvider: treeProvider });
    const tagsTreeView = vscode.window.createTreeView('mdTodoTags', { treeDataProvider: tagsTreeProvider });
    context.subscriptions.push(treeView, tagsTreeView);

    const initialEditor = vscode.window.activeTextEditor;
    if (initialEditor && isTodoFile(initialEditor.document)) {
        treeProvider.setCurrentTodoFile(initialEditor.document.uri);
        tagsTreeProvider.setCurrentTodoFile(initialEditor.document.uri);
        rememberLastTodoUri(initialEditor.document.uri);
    }

    // Track active editor → update tree's current file when a todo file becomes active.
    // Don't blank out the tree when focus shifts to a non-todo editor (like the tree itself).
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(editor => {
            if (editor && isTodoFile(editor.document)) {
                treeProvider.setCurrentTodoFile(editor.document.uri);
                tagsTreeProvider.setCurrentTodoFile(editor.document.uri);
                rememberLastTodoUri(editor.document.uri);
            }
        }),
        vscode.workspace.onDidChangeTextDocument(event => {
            const userUri = treeProvider.getCurrentUri();
            if (userUri && event.document.uri.toString() === userUri.toString()) {
                treeProvider.refreshDebounced();
            }
            const tagUri = tagsTreeProvider.getCurrentUri();
            if (tagUri && event.document.uri.toString() === tagUri.toString()) {
                tagsTreeProvider.refreshDebounced();
            }
        }),
        vscode.workspace.onDidSaveTextDocument(doc => {
            const userUri = treeProvider.getCurrentUri();
            if (userUri && doc.uri.toString() === userUri.toString()) {
                treeProvider.refresh();
            }
            const tagUri = tagsTreeProvider.getCurrentUri();
            if (tagUri && doc.uri.toString() === tagUri.toString()) {
                tagsTreeProvider.refresh();
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('mdTodo.users.focusOnUser', (node?: TreeNode) =>
            focusOnUserFromTree(node)),
        vscode.commands.registerCommand('mdTodo.users.clearFocus', clearUserFocusFromTree),
        vscode.commands.registerCommand('mdTodo.users.reassignUser', (node?: TreeNode) =>
            reassignUserFromTree(treeProvider, node)),
        vscode.commands.registerCommand('mdTodo.users.markDoneFromTree', (node?: TreeNode) =>
            markDoneFromTree(treeProvider, node)),
        vscode.commands.registerCommand('mdTodo.tags.focusOnTag', (node?: TagsTreeNode) =>
            focusOnTagFromTree(node)),
        vscode.commands.registerCommand('mdTodo.tags.clearFocus', clearTagFocusFromTree),
        vscode.commands.registerCommand('mdTodo.tags.markDoneFromTree', (node?: TagsTreeNode) =>
            markDoneFromTagsTree(tagsTreeProvider, node)),
        vscode.commands.registerCommand('mdTodo.tags.editTagsFromTree', (node?: TagsTreeNode) =>
            editTagsFromTree(node))
    );
}
