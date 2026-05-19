import * as vscode from 'vscode';
import { setExtensionContext } from './state';
import { userHoverProvider, userCompletionProvider, tagCompletionProvider } from './completions';
import { addItem } from './commands-add-item';
import { markDone } from './commands-mark-done';
import { addNote } from './commands-add-note';
import { archiveItems } from './commands-archive';
import { showHistory } from './commands-history';
import { showStats } from './commands-stats';
import { quickAdd } from './commands-quick-add';
import { initializeTodoFile } from './commands-initialize';
import { addTags } from './commands-add-tags';
import { manageTags } from './commands-manage-tags';
import { addUser } from './commands-add-user';
import { assignFocusedUser } from './commands-assign-focused-user';
import { initFocusUserStatusBar, setFocusUser } from './focus-user';
import { initFocusTagStatusBar, setFocusTag } from './focus-tag';
import {
    initActivityFocusStatusBar,
    showRecentlyCompleted,
    showRecentlyAdded,
    showStaleItems,
    clearActivityFocus,
    activityFocusMenu,
} from './focus-activity';
import { registerTreeViews } from './tree-views';
import { registerAutoDateHandler } from './auto-date';
import { registerEditorUiEvents } from './editor-events';
import { clearParseCache } from './parser';
import { clearTagDecorationCache } from './decoration-tag';
import { clearDateDecorationCache } from './decoration-date';
import { clearMentionDecorationCache } from './decoration-mention';
import { clearDimDecorationCache } from './decoration-dim';

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
        vscode.commands.registerTextEditorCommand('mdTodo.addUser', addUser),
        vscode.commands.registerTextEditorCommand('mdTodo.initialize', initializeTodoFile),
        vscode.commands.registerCommand('mdTodo.setFocusUser', setFocusUser),
        vscode.commands.registerCommand('mdTodo.setFocusTag', setFocusTag),
        vscode.commands.registerTextEditorCommand('mdTodo.assignFocusedUser', assignFocusedUser),
        vscode.commands.registerTextEditorCommand('mdTodo.showRecentlyCompleted', showRecentlyCompleted),
        vscode.commands.registerTextEditorCommand('mdTodo.showRecentlyAdded', showRecentlyAdded),
        vscode.commands.registerTextEditorCommand('mdTodo.showStaleItems', showStaleItems),
        vscode.commands.registerCommand('mdTodo.clearActivityFocus', clearActivityFocus),
        vscode.commands.registerCommand('mdTodo.activityFocusMenu', activityFocusMenu),
    );

    initFocusUserStatusBar(context);
    initFocusTagStatusBar(context);
    initActivityFocusStatusBar(context);

    // Completion providers register against all docs so tags/users can be
    // autocompleted in any file (e.g. code, notes) sourced from the last
    // active mdtodo doc. The providers themselves no-op when no source is
    // available. Hover for @mentions stays scoped to markdown (it reads from
    // the current document, not a remembered source).
    context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider('*', tagCompletionProvider, '#'),
        vscode.languages.registerCompletionItemProvider('*', userCompletionProvider, '@'),
        vscode.languages.registerHoverProvider({ language: 'markdown' }, userHoverProvider),
    );

    registerTreeViews(context);
    registerAutoDateHandler(context);
    registerEditorUiEvents(context);

    context.subscriptions.push(
        vscode.workspace.onDidCloseTextDocument(doc => {
            clearParseCache(doc.uri);
            clearTagDecorationCache(doc.uri);
            clearDateDecorationCache(doc.uri);
            clearMentionDecorationCache(doc.uri);
            clearDimDecorationCache(doc.uri);
        }),
    );
}

export function deactivate() {}
