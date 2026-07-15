import * as vscode from 'vscode';
import { setExtensionContext } from './vscode/state';
import {
    userHoverProvider,
    userCompletionProvider,
    tagCompletionProvider,
    projectCompletionProvider,
} from './features/completions/completions';
import { addItem } from './features/items/commands-add-item';
import { markDone } from './features/items/commands-mark-done';
import { addNote } from './features/items/commands-add-note';
import { archiveItems } from './features/items/commands-archive';
import { showHistory } from './features/reports/commands-history';
import { showStats } from './features/reports/commands-stats';
import { quickAdd } from './features/items/commands-quick-add';
import { initializeTodoFile } from './features/initialize/commands-initialize';
import { addTags } from './features/tags/commands-add-tags';
import { manageTags } from './features/tags/commands-manage-tags';
import { setProject } from './features/projects/commands-set-project';
import { manageProjects } from './features/projects/commands-manage-projects';
import { showProjectView } from './features/projects/project-view';
import { addUser } from './features/users/commands-add-user';
import { assignFocusedUser } from './features/users/commands-assign-focused-user';
import { focusDimensions } from './features/focus';
import { userFocus } from './features/focus/focus-user';
import { tagFocus } from './features/focus/focus-tag';
import { projectFocus } from './features/focus/focus-project';
import { activityFocus } from './features/focus/focus-activity';
import {
    showRecentlyCompleted,
    showRecentlyAdded,
    showStaleItems,
    activityFocusMenu,
} from './features/reports/activity-reports';
import { registerTreeViews } from './registrations/views';
import { registerAutoDateHandler } from './features/auto-date/auto-date';
import { registerEditorUiEvents } from './registrations/events';
import { clearAllForUri, clearAll } from './vscode/cache-registry';

export function activate(context: vscode.ExtensionContext) {
    console.log('MD Todo is now active');
    setExtensionContext(context);

    context.subscriptions.push(
        vscode.commands.registerTextEditorCommand('mdTodo.addItem', addItem),
        vscode.commands.registerTextEditorCommand('mdTodo.markDone', markDone),
        vscode.commands.registerTextEditorCommand('mdTodo.addNote', addNote),
        vscode.commands.registerTextEditorCommand('mdTodo.archive', archiveItems),
        vscode.commands.registerTextEditorCommand('mdTodo.showHistory', showHistory),
        vscode.commands.registerTextEditorCommand('mdTodo.showStats', showStats),
        vscode.commands.registerTextEditorCommand('mdTodo.quickAdd', quickAdd),
        vscode.commands.registerTextEditorCommand('mdTodo.addTags', addTags),
        vscode.commands.registerTextEditorCommand('mdTodo.manageTags', manageTags),
        vscode.commands.registerTextEditorCommand('mdTodo.setProject', setProject),
        vscode.commands.registerTextEditorCommand('mdTodo.manageProjects', manageProjects),
        vscode.commands.registerTextEditorCommand('mdTodo.showProjectView', showProjectView),
        vscode.commands.registerTextEditorCommand('mdTodo.addUser', addUser),
        vscode.commands.registerTextEditorCommand('mdTodo.initialize', initializeTodoFile),
        vscode.commands.registerTextEditorCommand('mdTodo.assignFocusedUser', assignFocusedUser),
        vscode.commands.registerTextEditorCommand(
            'mdTodo.showRecentlyCompleted',
            showRecentlyCompleted
        ),
        vscode.commands.registerTextEditorCommand('mdTodo.showRecentlyAdded', showRecentlyAdded),
        vscode.commands.registerTextEditorCommand('mdTodo.showStaleItems', showStaleItems),
        vscode.commands.registerCommand('mdTodo.activityFocusMenu', activityFocusMenu),
        vscode.commands.registerCommand('mdTodo.setFocusActivity', activityFocusMenu),
        vscode.commands.registerCommand('mdTodo.clearAllFocus', async () => {
            await userFocus.clear();
            await tagFocus.clear();
            await projectFocus.clear();
            await activityFocus.clear();
        })
    );

    // Each dimension registers its status-bar item and commands
    // (mdTodo.setFocusUser/Tag/Project, mdTodo.clearActivityFocus) itself.
    for (const dimension of focusDimensions) {
        dimension.register(context);
    }

    // Completion providers register against all docs so tags/users can be
    // autocompleted in any file (e.g. code, notes) sourced from the last
    // active mdtodo doc. The providers themselves no-op when no source is
    // available. Hover for @mentions stays scoped to markdown (it reads from
    // the current document, not a remembered source).
    context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider('*', tagCompletionProvider, '#'),
        vscode.languages.registerCompletionItemProvider('*', userCompletionProvider, '@'),
        vscode.languages.registerCompletionItemProvider('*', projectCompletionProvider, '['),
        vscode.languages.registerHoverProvider({ language: 'markdown' }, userHoverProvider)
    );

    registerTreeViews(context);
    registerAutoDateHandler(context);
    registerEditorUiEvents(context);

    // Every per-URI cache (parse memo + decoration caches) registers itself
    // with the CacheRegistry, so closing a document invalidates all of them
    // with one call (F-11) and deactivation empties them wholesale (F-12).
    context.subscriptions.push(
        vscode.workspace.onDidCloseTextDocument((doc) => {
            clearAllForUri(doc.uri);
        }),
        { dispose: clearAll }
    );
}

export function deactivate() {
    // Nothing to do here (F-12): every decoration type and per-URI cache is
    // owned by a DecorationController pushed to context.subscriptions, the
    // status-bar items, tree views, providers, and event listeners are all
    // subscription-managed, and the CacheRegistry clearAll disposable empties
    // the remaining memos. VS Code requires the export to exist.
}
