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
import { initFocusUserStatusBar, setFocusUser, clearFocusUser } from './features/focus/focus-user';
import { initFocusTagStatusBar, setFocusTag, clearFocusTag } from './features/focus/focus-tag';
import {
    initFocusProjectStatusBar,
    setFocusProject,
    clearFocusProject,
} from './features/focus/focus-project';
import {
    initActivityFocusStatusBar,
    showRecentlyCompleted,
    showRecentlyAdded,
    showStaleItems,
    clearActivityFocus,
    activityFocusMenu,
} from './features/focus/focus-activity';
import { registerTreeViews } from './registrations/views';
import { registerAutoDateHandler } from './features/auto-date/auto-date';
import { registerEditorUiEvents } from './registrations/events';
import { clearParseCache } from './core/parser';
import { clearTagDecorationCache } from './features/decorations/decoration-tag';
import { clearDateDecorationCache } from './features/decorations/decoration-date';
import { clearMentionDecorationCache } from './features/decorations/decoration-mention';
import { clearProjectDecorationCache } from './features/decorations/decoration-project';
import { clearDimDecorationCache } from './features/focus/decoration-dim';

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
        vscode.commands.registerCommand('mdTodo.setFocusUser', setFocusUser),
        vscode.commands.registerCommand('mdTodo.setFocusTag', setFocusTag),
        vscode.commands.registerCommand('mdTodo.setFocusProject', setFocusProject),
        vscode.commands.registerTextEditorCommand('mdTodo.assignFocusedUser', assignFocusedUser),
        vscode.commands.registerTextEditorCommand(
            'mdTodo.showRecentlyCompleted',
            showRecentlyCompleted
        ),
        vscode.commands.registerTextEditorCommand('mdTodo.showRecentlyAdded', showRecentlyAdded),
        vscode.commands.registerTextEditorCommand('mdTodo.showStaleItems', showStaleItems),
        vscode.commands.registerCommand('mdTodo.clearActivityFocus', clearActivityFocus),
        vscode.commands.registerCommand('mdTodo.activityFocusMenu', activityFocusMenu),
        vscode.commands.registerCommand('mdTodo.setFocusActivity', activityFocusMenu),
        vscode.commands.registerCommand('mdTodo.clearAllFocus', async () => {
            await clearFocusUser();
            await clearFocusTag();
            await clearFocusProject();
            await clearActivityFocus();
        })
    );

    initFocusUserStatusBar(context);
    initFocusTagStatusBar(context);
    initFocusProjectStatusBar(context);
    initActivityFocusStatusBar(context);

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

    context.subscriptions.push(
        vscode.workspace.onDidCloseTextDocument((doc) => {
            clearParseCache(doc.uri);
            clearTagDecorationCache(doc.uri);
            clearDateDecorationCache(doc.uri);
            clearMentionDecorationCache(doc.uri);
            clearProjectDecorationCache(doc.uri);
            clearDimDecorationCache(doc.uri);
        })
    );
}

// Intentionally empty: disposal is centralized in Phase 3 (F-12); VS Code
// requires the export to exist.
// eslint-disable-next-line @typescript-eslint/no-empty-function
export function deactivate() {}
