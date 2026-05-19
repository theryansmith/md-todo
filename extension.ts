import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';
import {
    TodoItem,
    TagDefinition,
    UserDefinition,
    ParsedDocument,
    TagValidationResult,
    EffectiveEditorContext,
    ActivityKind,
    ActivityFocus,
    SuggestionItem,
    UserNode,
    SectionNode,
    TodoNode,
    UnassignedNode,
    TreeNode,
    TagRootNode,
    TagSectionNode,
    TagTodoNode,
    UntaggedNode,
    TagsTreeNode,
} from './types';
import {
    getToday,
    parseDate,
    daysBetween,
    formatIsoDate,
    startOfToday,
    parseNaturalDateRange,
} from './dates';
import {
    isTodoFile,
    isNoteLine,
    isNestedTodoLine,
    findItemForSourceLine,
    validateTags,
    isNestedItem,
    getItemWithDescendantsEndLine,
    findItemByLine,
    getEffectiveEditor,
    parseDocument,
    findItemAtCursor,
    getItemEndLine,
    classifyItemSection,
    itemMatchesActivity,
} from './parser';
import {
    setExtensionContext,
    getFocusUser,
    setFocusUserState,
    getFocusTag,
    setFocusTagState,
    getActivityFocus,
    setActivityFocusState,
    rememberLastTodoUri,
    getLastTodoSourceDoc,
} from './state';
import { updateTagDecorations } from './decoration-tag';
import { createDateDecorationType, updateDateDecorations } from './decoration-date';
import { updateMentionDecorations } from './decoration-mention';
import { updateDimDecorations } from './decoration-dim';
import {
    addTagDefinition,
    addUserDefinition,
    promptCreateTags,
    processTagsWithValidation,
    sortedSuggestions,
    promptForTodoText,
} from './prompts';
import {
    userHoverProvider,
    userCompletionProvider,
    tagCompletionProvider,
} from './completions';
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
import {
    initFocusUserStatusBar,
    refreshFocusStatusBar,
    setFocusUser,
} from './focus-user';
import {
    initFocusTagStatusBar,
    refreshFocusTagStatusBar,
    setFocusTag,
} from './focus-tag';
import {
    initActivityFocusStatusBar,
    refreshActivityFocusStatusBar,
    refreshAllActivityUI,
    showRecentlyCompleted,
    showRecentlyAdded,
    showStaleItems,
    clearActivityFocus,
    activityFocusMenu,
} from './focus-activity';

const execAsync = promisify(exec);


// ============================================================================
// Extension Activation
// ============================================================================

export function activate(context: vscode.ExtensionContext) {
    console.log('MD Todo is now active');
    setExtensionContext(context);

    const commands = [
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
        vscode.commands.registerTextEditorCommand('mdTodo.assignFocusedUser', assignFocusedUser),
    ];

    context.subscriptions.push(...commands);

    initFocusUserStatusBar(context);
    initFocusTagStatusBar(context);
    initActivityFocusStatusBar(context);

    context.subscriptions.push(
        vscode.commands.registerCommand('mdTodo.setFocusTag', setFocusTag),
        vscode.commands.registerTextEditorCommand('mdTodo.showRecentlyCompleted', showRecentlyCompleted),
        vscode.commands.registerTextEditorCommand('mdTodo.showRecentlyAdded', showRecentlyAdded),
        vscode.commands.registerTextEditorCommand('mdTodo.showStaleItems', showStaleItems),
        vscode.commands.registerCommand('mdTodo.clearActivityFocus', clearActivityFocus),
        vscode.commands.registerCommand('mdTodo.activityFocusMenu', activityFocusMenu),
        // Completion providers register against all docs so tags/users can be
        // autocompleted in any file (e.g. code, notes) sourced from the last
        // active mdtodo doc. The providers themselves no-op when no source is
        // available.
        vscode.languages.registerCompletionItemProvider('*', tagCompletionProvider, '#')
    );

    // Hover for @mentions stays scoped to markdown (it reads from the current
    // document, not a remembered source).
    context.subscriptions.push(
        vscode.languages.registerHoverProvider({ language: 'markdown' }, userHoverProvider),
        vscode.languages.registerCompletionItemProvider(
            '*',
            userCompletionProvider,
            '@'
        )
    );

    // ----- Users tree view (Variant B) + Tags tree view (Variant BC3) -----
    const treeProvider = new MdTodoUsersTreeProvider(context.workspaceState);
    const tagsTreeProvider = new MdTodoTagsTreeProvider(context.workspaceState);
    const treeView = vscode.window.createTreeView('mdTodoUsers', { treeDataProvider: treeProvider });
    const tagsTreeView = vscode.window.createTreeView('mdTodoTags', { treeDataProvider: tagsTreeProvider });
    context.subscriptions.push(treeView, tagsTreeView);

    // Initialize current todo file from active editor if applicable
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

    // Tree-driven commands
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

    // Auto-add date to manually typed notes and todos
    let isAutoAddingDate = false;
    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument(async (event) => {
            // Skip if already processing
            if (isAutoAddingDate) { return; }

            const editor = vscode.window.activeTextEditor;
            if (!editor || event.document !== editor.document) { return; }
            if (!isTodoFile(event.document)) { return; }

            // Look for changes that are Enter key presses (inserting newlines)
            for (const change of event.contentChanges) {
                if (!change.text.includes('\n')) { continue; }

                // Check the line before the cursor (the line that was just completed)
                const lineBeforeNum = change.range.start.line;
                if (lineBeforeNum < 0 || lineBeforeNum >= event.document.lineCount) { continue; }

                const lineBefore = event.document.lineAt(lineBeforeNum).text;
                const today = getToday();
                const datePattern = /`\+\d{4}-\d{2}-\d{2}`/;

                // Check for note line without date: "  - text" (indented bullet, not a checkbox)
                const noteMatch = lineBefore.match(/^(\s+)-\s+(?!\[[ xX]\])(.+)$/);
                if (noteMatch && !datePattern.test(lineBefore)) {
                    const existingText = noteMatch[2].trim();
                    // Don't add date if line is empty/just whitespace after the bullet
                    if (existingText && existingText.length > 0) {
                        isAutoAddingDate = true;
                        try {
                            const lineRange = event.document.lineAt(lineBeforeNum).range;
                            const indent = noteMatch[1];
                            const newText = `${indent}- ${existingText} \`+${today}\``;
                            await editor.edit((editBuilder) => {
                                editBuilder.replace(lineRange, newText);
                            }, { undoStopBefore: false, undoStopAfter: false });
                        } finally {
                            isAutoAddingDate = false;
                        }
                    }
                    continue;
                }

                // Check for todo line without date: "- [ ] text" (checkbox, no tags considered)
                const todoMatch = lineBefore.match(/^(\s*)-\s*\[([ xX])\]\s*(.+)$/);
                if (todoMatch && !datePattern.test(lineBefore)) {
                    const existingText = todoMatch[3].trim();
                    // Don't add date if text is empty
                    if (existingText && existingText.length > 0) {
                        isAutoAddingDate = true;
                        try {
                            const lineRange = event.document.lineAt(lineBeforeNum).range;
                            const indent = todoMatch[1];
                            const checkbox = todoMatch[2];
                            const newText = `${indent}- [${checkbox}] ${existingText} \`+${today}\``;
                            await editor.edit((editBuilder) => {
                                editBuilder.replace(lineRange, newText);
                            }, { undoStopBefore: false, undoStopAfter: false });
                        } finally {
                            isAutoAddingDate = false;
                        }
                    }
                }
            }
        })
    );

    // Tag, date, mention, and dim decorations. Each decoration type is layered
    // additively — order matters for clarity but VSCode applies them all.
    if (vscode.window.activeTextEditor) {
        updateTagDecorations(vscode.window.activeTextEditor);
        updateDateDecorations(vscode.window.activeTextEditor);
        updateMentionDecorations(vscode.window.activeTextEditor);
        updateDimDecorations(vscode.window.activeTextEditor);
        refreshFocusStatusBar(vscode.window.activeTextEditor);
        refreshFocusTagStatusBar(vscode.window.activeTextEditor);
        refreshActivityFocusStatusBar(vscode.window.activeTextEditor);
    }

    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(editor => {
            if (editor) {
                updateTagDecorations(editor);
                updateDateDecorations(editor);
                updateMentionDecorations(editor);
                updateDimDecorations(editor);
            }
            refreshFocusStatusBar(editor);
            refreshFocusTagStatusBar(editor);
            refreshActivityFocusStatusBar(editor);
        }),
        vscode.workspace.onDidChangeTextDocument(event => {
            const editor = vscode.window.activeTextEditor;
            if (editor && event.document === editor.document) {
                updateTagDecorations(editor);
                updateDateDecorations(editor);
                updateMentionDecorations(editor);
                updateDimDecorations(editor);
                // Status bar tooltip depends on parsed user defs — refresh too.
                refreshFocusStatusBar(editor);
                refreshFocusTagStatusBar(editor);
                refreshActivityFocusStatusBar(editor);
            }
        }),
        vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration('mdTodo.dateOpacity')) {
                // Recreate decoration type with new opacity
                createDateDecorationType();
                // Reapply decorations to active editor
                const editor = vscode.window.activeTextEditor;
                if (editor) {
                    updateDateDecorations(editor);
                }
            }
        })
    );
}

export function deactivate() {}
