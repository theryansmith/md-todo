import * as vscode from 'vscode';
import { TreeNode, TagsTreeNode, ProjectsTreeNode } from '../features/tree-nodes';
import { isTodoFile } from '../core/parser';
import { rememberLastTodoUri } from '../vscode/state';
import {
    MdTodoUsersTreeProvider,
    focusOnUserFromTree,
    clearUserFocusFromTree,
    reassignUserFromTree,
    markDoneFromTree,
} from '../features/users/tree-users';
import {
    MdTodoTagsTreeProvider,
    focusOnTagFromTree,
    clearTagFocusFromTree,
    markDoneFromTagsTree,
    editTagsFromTree,
} from '../features/tags/tree-tags';
import {
    MdTodoProjectsTreeProvider,
    focusOnProjectFromTree,
    clearProjectFocusFromTree,
    markDoneFromProjectsTree,
    setProjectFromTree,
    showProjectViewFromTree,
} from '../features/projects/tree-projects';
import { isWhitespaceOnlyChange } from './events';

/**
 * Create the tree providers + views, seed them with the active todo file,
 * subscribe them to editor/document events, and register the tree-driven
 * commands. Tree-views (Users + Tags + Projects) are siblings sharing
 * identical wiring, so they're set up together here.
 */
export function registerTreeViews(context: vscode.ExtensionContext): void {
    const treeProvider = new MdTodoUsersTreeProvider(context.workspaceState);
    const tagsTreeProvider = new MdTodoTagsTreeProvider(context.workspaceState);
    const projectsTreeProvider = new MdTodoProjectsTreeProvider(context.workspaceState);
    const treeView = vscode.window.createTreeView('mdTodoUsers', {
        treeDataProvider: treeProvider,
    });
    const tagsTreeView = vscode.window.createTreeView('mdTodoTags', {
        treeDataProvider: tagsTreeProvider,
    });
    const projectsTreeView = vscode.window.createTreeView('mdTodoProjects', {
        treeDataProvider: projectsTreeProvider,
    });
    context.subscriptions.push(treeView, tagsTreeView, projectsTreeView);

    const initialEditor = vscode.window.activeTextEditor;
    if (initialEditor && isTodoFile(initialEditor.document)) {
        treeProvider.setCurrentTodoFile(initialEditor.document.uri);
        tagsTreeProvider.setCurrentTodoFile(initialEditor.document.uri);
        projectsTreeProvider.setCurrentTodoFile(initialEditor.document.uri);
        rememberLastTodoUri(initialEditor.document.uri);
    }

    // Track active editor → update tree's current file when a todo file becomes active.
    // Don't blank out the tree when focus shifts to a non-todo editor (like the tree itself).
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor((editor) => {
            if (editor && isTodoFile(editor.document)) {
                treeProvider.setCurrentTodoFile(editor.document.uri);
                tagsTreeProvider.setCurrentTodoFile(editor.document.uri);
                projectsTreeProvider.setCurrentTodoFile(editor.document.uri);
                rememberLastTodoUri(editor.document.uri);
            }
        }),
        vscode.workspace.onDidChangeTextDocument((event) => {
            if (isWhitespaceOnlyChange(event)) {
                return;
            }
            const userUri = treeProvider.getCurrentUri();
            if (event.document.uri.toString() === userUri?.toString()) {
                treeProvider.refreshDebounced();
            }
            const tagUri = tagsTreeProvider.getCurrentUri();
            if (event.document.uri.toString() === tagUri?.toString()) {
                tagsTreeProvider.refreshDebounced();
            }
            const projectUri = projectsTreeProvider.getCurrentUri();
            if (event.document.uri.toString() === projectUri?.toString()) {
                projectsTreeProvider.refreshDebounced();
            }
        }),
        vscode.workspace.onDidSaveTextDocument((doc) => {
            const userUri = treeProvider.getCurrentUri();
            if (doc.uri.toString() === userUri?.toString()) {
                treeProvider.refresh();
            }
            const tagUri = tagsTreeProvider.getCurrentUri();
            if (doc.uri.toString() === tagUri?.toString()) {
                tagsTreeProvider.refresh();
            }
            const projectUri = projectsTreeProvider.getCurrentUri();
            if (doc.uri.toString() === projectUri?.toString()) {
                projectsTreeProvider.refresh();
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('mdTodo.users.focusOnUser', (node?: TreeNode) =>
            focusOnUserFromTree(node)
        ),
        vscode.commands.registerCommand('mdTodo.users.clearFocus', clearUserFocusFromTree),
        vscode.commands.registerCommand('mdTodo.users.reassignUser', (node?: TreeNode) =>
            reassignUserFromTree(treeProvider, node)
        ),
        vscode.commands.registerCommand('mdTodo.users.markDoneFromTree', (node?: TreeNode) =>
            markDoneFromTree(treeProvider, node)
        ),
        vscode.commands.registerCommand('mdTodo.tags.focusOnTag', (node?: TagsTreeNode) =>
            focusOnTagFromTree(node)
        ),
        vscode.commands.registerCommand('mdTodo.tags.clearFocus', clearTagFocusFromTree),
        vscode.commands.registerCommand('mdTodo.tags.markDoneFromTree', (node?: TagsTreeNode) =>
            markDoneFromTagsTree(tagsTreeProvider, node)
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
            (node?: ProjectsTreeNode) => markDoneFromProjectsTree(projectsTreeProvider, node)
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
