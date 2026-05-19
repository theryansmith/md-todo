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
import { markDone } from './commands-mark-done';
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
// Commands
// ============================================================================

async function addItem(editor: vscode.TextEditor) {
    // Get effective editor (handles filtered views)
    const ctx = await getEffectiveEditor(editor);
    const effectiveEditor = ctx.editor;
    const effectiveDocument = ctx.document;

    if (!isTodoFile(effectiveDocument)) {
        vscode.window.showWarningMessage('Not a todo file. Add "md-todo: true" to YAML frontmatter.');
        return;
    }

    const text = await promptForTodoText(effectiveDocument, {
        prompt: 'Enter todo item',
        placeHolder: 'What needs to be done? (type @ or # for suggestions)'
    });

    if (!text) { return; }

    const today = getToday();
    const newLine = `- [ ] ${text} \`+${today}\``;

    const parsed = parseDocument(effectiveDocument);

    // Find the "Active" section or insert at top
    const activeSection = parsed.sections.get('active');
    let insertLine: number;

    if (activeSection) {
        insertLine = activeSection.start + 1;
    } else {
        // Look for first ## header and insert after it, or at line 0
        for (let i = 0; i < effectiveDocument.lineCount; i++) {
            if (effectiveDocument.lineAt(i).text.startsWith('## ')) {
                insertLine = i + 1;
                break;
            }
        }
        insertLine = insertLine! ?? 0;
    }

    // Skip blank lines after section header
    while (insertLine < effectiveDocument.lineCount && effectiveDocument.lineAt(insertLine).text.trim() === '') {
        insertLine++;
    }

    await effectiveEditor.edit((editBuilder: vscode.TextEditorEdit) => {
        editBuilder.insert(new vscode.Position(insertLine, 0), newLine + '\n');
    });

    vscode.window.showInformationMessage(`Added: ${text}`);
}

async function addNote(editor: vscode.TextEditor) {
    const ctx = await getEffectiveEditor(editor);
    const effectiveEditor = ctx.editor;
    const effectiveDocument = ctx.document;

    if (!isTodoFile(effectiveDocument)) {
        vscode.window.showWarningMessage('Not a todo file. Add "md-todo: true" to YAML frontmatter.');
        return;
    }

    const result = findItemAtCursor(effectiveEditor);

    if (!result) {
        // No item at cursor, show picker
        const parsed = parseDocument(effectiveDocument);

        if (parsed.items.length === 0) {
            vscode.window.showInformationMessage('No todo items found');
            return;
        }

        const picks = parsed.items.map(item => ({
            label: `${item.isComplete ? '✓' : '○'} ${item.text}`,
            description: item.notes.length > 0 ? `${item.notes.length} notes` : '',
            item
        }));

        const selected = await vscode.window.showQuickPick(picks, {
            placeHolder: 'Select item to add note'
        });

        if (!selected) { return; }

        await addNoteToItem(effectiveEditor, selected.item);
    } else {
        await addNoteToItem(effectiveEditor, result.item);
    }
}

async function addNoteToItem(editor: vscode.TextEditor, item: TodoItem) {
    const note = await promptForTodoText(editor.document, {
        prompt: `Add note to: ${item.text}`,
        placeHolder: 'Progress update... (type @ or # for suggestions)'
    });

    if (!note) { return; }

    const document = editor.document;
    const today = getToday();
    const endLine = getItemEndLine(document, item.line);
    // Note indent = item's indent + 2 spaces (relative to parent todo)
    const indent = ' '.repeat(item.indent + 2);
    const noteLine = `${indent}- ${note} \`+${today}\``;

    await editor.edit((editBuilder: vscode.TextEditorEdit) => {
        const insertPosition = new vscode.Position(endLine + 1, 0);
        editBuilder.insert(insertPosition, noteLine + '\n');
    });

    vscode.window.showInformationMessage('Note added');
}

async function archiveItems(editor: vscode.TextEditor) {
    // Get effective editor (handles filtered views)
    const ctx = await getEffectiveEditor(editor);
    const effectiveEditor = ctx.editor;
    const effectiveDocument = ctx.document;

    if (!isTodoFile(effectiveDocument)) {
        vscode.window.showWarningMessage('Not a todo file. Add "md-todo: true" to YAML frontmatter.');
        return;
    }

    const config = vscode.workspace.getConfiguration('mdTodo');
    const archiveAfterDays = config.get<number>('archiveAfterDays', 7);

    const parsed = parseDocument(effectiveDocument);
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Normalize to midnight for accurate day comparison

    // Find items ready for archive
    const toArchive = parsed.items.filter(item => {
        if (!item.isComplete || !item.completedDate) { return false; }
        const completed = parseDate(item.completedDate);
        if (!completed) { return false; }
        return daysBetween(today, completed) >= archiveAfterDays;
    });

    if (toArchive.length === 0) {
        vscode.window.showInformationMessage(`No items completed more than ${archiveAfterDays} days ago`);
        return;
    }

    // Build archive text
    const archiveSection = parsed.sections.get('archive');

    // Collect full item text including notes
    const archiveTexts: string[] = [];
    const linesToDelete: number[] = [];

    for (const item of toArchive) {
        const endLine = getItemEndLine(effectiveDocument, item.line);
        const lines: string[] = [];
        for (let i = item.line; i <= endLine; i++) {
            lines.push(effectiveDocument.lineAt(i).text);
            linesToDelete.push(i);
        }
        archiveTexts.push(lines.join('\n'));
    }

    // Sort lines to delete in reverse order
    linesToDelete.sort((a, b) => b - a);

    await effectiveEditor.edit((editBuilder: vscode.TextEditorEdit) => {
        // Delete archived items (in reverse order to preserve line numbers)
        const processed = new Set<number>();
        for (const lineNum of linesToDelete) {
            if (processed.has(lineNum)) { continue; }
            processed.add(lineNum);
            const range = new vscode.Range(lineNum, 0, lineNum + 1, 0);
            editBuilder.delete(range);
        }

        // Add to archive section
        const archiveText: string = '\n' + archiveTexts.join('\n') + '\n';

        if (archiveSection) {
            // Insert at start of archive section
            const insertPos: vscode.Position = new vscode.Position(archiveSection.start + 1, 0);
            editBuilder.insert(insertPos, archiveText);
        } else {
            // Create archive section at end
            const endPos: vscode.Position = new vscode.Position(effectiveDocument.lineCount, 0);
            editBuilder.insert(endPos, `\n## Archive\n${archiveText}`);
        }
    });

    vscode.window.showInformationMessage(`Archived ${toArchive.length} items`);
}

async function showHistory(editor: vscode.TextEditor) {
    // Get effective editor (handles filtered views)
    const ctx = await getEffectiveEditor(editor);
    const effectiveDocument = ctx.document;

    if (!isTodoFile(effectiveDocument)) {
        vscode.window.showWarningMessage('Not a todo file. Add "md-todo: true" to YAML frontmatter.');
        return;
    }

    const workspaceFolder = vscode.workspace.getWorkspaceFolder(effectiveDocument.uri);
    if (!workspaceFolder) {
        vscode.window.showErrorMessage('Not in a workspace');
        return;
    }

    const filePath = effectiveDocument.uri.fsPath;
    const cwd = workspaceFolder.uri.fsPath;
    
    try {
        // Get git log for this file
        const { stdout } = await execAsync(
            `git log --oneline --follow -20 -- "${filePath}"`,
            { cwd }
        );
        
        if (!stdout.trim()) {
            vscode.window.showInformationMessage('No git history found for this file');
            return;
        }
        
        interface Commit {
            hash: string;
            message: string;
        }

        const commits: Commit[] = stdout.trim().split('\n').map((line: string) => {
            const [hash, ...messageParts] = line.split(' ');
            return { hash, message: messageParts.join(' ') };
        });
        
        // Show quick pick to select commit
        const picks = commits.map(c => ({
            label: c.hash,
            description: c.message,
            commit: c
        }));
        
        const selected = await vscode.window.showQuickPick(picks, {
            placeHolder: 'Select commit to view diff'
        });
        
        if (!selected) { return; }
        
        // Show diff
        const { stdout: diff } = await execAsync(
            `git show ${selected.commit.hash} --format="" -- "${filePath}"`,
            { cwd }
        );
        
        // Create a new document with the diff
        const doc = await vscode.workspace.openTextDocument({
            content: `# Changes in ${selected.commit.hash}\n${selected.commit.message}\n\n${diff}`,
            language: 'diff'
        });
        
        await vscode.window.showTextDocument(doc, { preview: true });
        
    } catch (error) {
        vscode.window.showErrorMessage(`Git error: ${error}`);
    }
}

async function showStats(editor: vscode.TextEditor) {
    // Get effective editor (handles filtered views)
    const ctx = await getEffectiveEditor(editor);
    const effectiveDocument = ctx.document;

    if (!isTodoFile(effectiveDocument)) {
        vscode.window.showWarningMessage('Not a todo file. Add "md-todo: true" to YAML frontmatter.');
        return;
    }

    const parsed = parseDocument(effectiveDocument);
    const today = new Date();
    
    // Calculate stats
    const completed = parsed.items.filter(i => i.isComplete);
    const incomplete = parsed.items.filter(i => !i.isComplete);
    
    // Completed this week
    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 7);
    const completedThisWeek = completed.filter(item => {
        if (!item.completedDate) { return false; }
        const d = parseDate(item.completedDate);
        return d && d >= weekAgo;
    });
    
    // Average time to completion
    const completionTimes: number[] = [];
    for (const item of completed) {
        if (item.addedDate && item.completedDate) {
            const added = parseDate(item.addedDate);
            const done = parseDate(item.completedDate);
            if (added && done) {
                completionTimes.push(daysBetween(added, done));
            }
        }
    }
    const avgCompletion = completionTimes.length > 0
        ? (completionTimes.reduce((a, b) => a + b, 0) / completionTimes.length).toFixed(1)
        : 'N/A';
    
    // Oldest incomplete items
    const oldestIncomplete = incomplete
        .filter(i => i.addedDate)
        .sort((a, b) => {
            const da = parseDate(a.addedDate!);
            const db = parseDate(b.addedDate!);
            if (!da || !db) { return 0; }
            return da.getTime() - db.getTime();
        })
        .slice(0, 5);
    
    // Build stats display
    const statsLines = [
        `# 📊 Todo Stats`,
        ``,
        `## Overview`,
        `- **Total items:** ${parsed.items.length}`,
        `- **Completed:** ${completed.length}`,
        `- **Incomplete:** ${incomplete.length}`,
        ``,
        `## Velocity`,
        `- **Completed this week:** ${completedThisWeek.length}`,
        `- **Avg completion time:** ${avgCompletion} days`,
        ``,
        `## Oldest Open Items`,
    ];
    
    for (const item of oldestIncomplete) {
        const age = item.addedDate 
            ? `${daysBetween(today, parseDate(item.addedDate)!)} days old`
            : 'unknown age';
        statsLines.push(`- ${item.text} (${age})`);
    }
    
    if (oldestIncomplete.length === 0) {
        statsLines.push(`- No dated incomplete items`);
    }
    
    // Show in new document
    const doc = await vscode.workspace.openTextDocument({
        content: statsLines.join('\n'),
        language: 'markdown'
    });
    
    await vscode.window.showTextDocument(doc, { 
        preview: true, 
        viewColumn: vscode.ViewColumn.Beside 
    });
}

async function quickAdd(editor: vscode.TextEditor) {
    // Get effective editor (handles filtered views)
    const ctx = await getEffectiveEditor(editor);
    const effectiveEditor = ctx.editor;

    if (!isTodoFile(ctx.document)) {
        vscode.window.showWarningMessage('Not a todo file. Add "md-todo: true" to YAML frontmatter.');
        return;
    }

    const today = getToday();
    const cursorPos = effectiveEditor.selection.active;

    // Insert at cursor position
    const text = `- [ ]  \`+${today}\``;

    await effectiveEditor.edit((editBuilder: vscode.TextEditorEdit) => {
        editBuilder.insert(cursorPos, text);
    });

    // Move cursor to between ] and backtick for typing
    const newPos = new vscode.Position(cursorPos.line, cursorPos.character + 6);
    effectiveEditor.selection = new vscode.Selection(newPos, newPos);
}

async function initializeTodoFile(editor: vscode.TextEditor) {
    const document = editor.document;

    if (document.languageId !== 'markdown') {
        vscode.window.showWarningMessage('Initialize only works on markdown files');
        return;
    }

    if (isTodoFile(document)) {
        vscode.window.showInformationMessage('File is already a todo file');
        return;
    }

    const template = `---
md-todo: true
---

# TODO

## Active

## Completed

## Archive

<!-- Completed items older than 7 days get moved here -->

## Tags

`;

    if (document.getText().trim() === '') {
        // Empty file - insert full template
        await editor.edit(editBuilder => {
            editBuilder.insert(new vscode.Position(0, 0), template);
        });
        vscode.window.showInformationMessage('Todo file initialized');
    } else {
        // File has content - ask user
        const choice = await vscode.window.showQuickPick(
            ['Prepend frontmatter only', 'Replace entire file', 'Cancel'],
            { placeHolder: 'File has existing content. How to initialize?' }
        );

        if (choice === 'Prepend frontmatter only') {
            await editor.edit(editBuilder => {
                editBuilder.insert(new vscode.Position(0, 0), '---\nmd-todo: true\n---\n\n');
            });
            vscode.window.showInformationMessage('Todo frontmatter added');
        } else if (choice === 'Replace entire file') {
            const confirm = await vscode.window.showWarningMessage(
                'This will replace all content. Continue?',
                { modal: true },
                'Yes'
            );

            if (confirm === 'Yes') {
                const fullRange = new vscode.Range(
                    new vscode.Position(0, 0),
                    new vscode.Position(document.lineCount, 0)
                );
                await editor.edit(editBuilder => {
                    editBuilder.replace(fullRange, template);
                });
                vscode.window.showInformationMessage('Todo file initialized');
            }
        }
    }
}

// ============================================================================
// Tag Commands
// ============================================================================

async function addTags(editor: vscode.TextEditor) {
    // Get effective editor (handles filtered views)
    const ctx = await getEffectiveEditor(editor);
    const effectiveEditor = ctx.editor;
    const effectiveDocument = ctx.document;

    if (!isTodoFile(effectiveDocument)) {
        vscode.window.showWarningMessage('Not a todo file. Add "md-todo: true" to YAML frontmatter.');
        return;
    }

    // Find item at cursor
    let result = findItemAtCursor(effectiveEditor);

    if (!result) {
        const parsed = parseDocument(effectiveDocument);

        if (parsed.items.length === 0) {
            vscode.window.showInformationMessage('No todo items found');
            return;
        }

        const picks = parsed.items.map(item => ({
            label: `${item.isComplete ? '✓' : '○'} ${item.text}`,
            description: item.tags.length > 0 ? item.tags.map(t => `#${t}`).join(' ') : '',
            item
        }));

        const selected = await vscode.window.showQuickPick(picks, {
            placeHolder: 'Select item to tag'
        });

        if (!selected) { return; }
        result = { item: selected.item, lineNum: selected.item.line };
    }

    const parsed = parseDocument(effectiveDocument);

    // Use native multi-select for tag selection (same style as filter by tags)
    const existingTags = result.item.tags;
    const picks = [...parsed.tagDefinitions]
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
        .map(tag => ({
            label: tag.name,
            description: tag.description,
            picked: existingTags.includes(tag.name)
        }));

    const selected = await vscode.window.showQuickPick(picks, {
        canPickMany: true,
        placeHolder: 'Select tags for this item'
    });

    if (!selected) { return; }
    const selectedTags = selected.map(s => s.label);

    // Validate and auto-create undefined tags
    const finalTags = await processTagsWithValidation(effectiveEditor, selectedTags);
    if (finalTags === null) { return; }

    await updateItemTags(effectiveEditor, result.item, finalTags);
}

async function updateItemTags(editor: vscode.TextEditor, item: TodoItem, newTags: string[]) {
    const document = editor.document;
    const line = document.lineAt(item.line);
    let newText = line.text;

    // Remove existing tags
    newText = newText.replace(/#[\w-]+/g, '').replace(/\s+$/, '');

    // Add new tags at the end
    if (newTags.length > 0) {
        const tagString = newTags.map(t => `#${t}`).join(' ');
        newText = newText + ' ' + tagString;
    }

    await editor.edit((editBuilder: vscode.TextEditorEdit) => {
        editBuilder.replace(line.range, newText);
    });

    vscode.window.showInformationMessage(`Tags updated: ${newTags.length > 0 ? newTags.map(t => `#${t}`).join(' ') : '(none)'}`);
}

async function manageTags(editor: vscode.TextEditor) {
    // Get effective editor (handles filtered views)
    const ctx = await getEffectiveEditor(editor);
    const effectiveEditor = ctx.editor;
    const effectiveDocument = ctx.document;

    if (!isTodoFile(effectiveDocument)) {
        vscode.window.showWarningMessage('Not a todo file. Add "md-todo: true" to YAML frontmatter.');
        return;
    }

    const parsed = parseDocument(effectiveDocument);

    interface ActionItem extends vscode.QuickPickItem {
        action: string;
        tagDef?: TagDefinition;
    }

    const picks: ActionItem[] = [
        { label: '$(add) Add new tag', action: 'add' },
        { label: '', kind: vscode.QuickPickItemKind.Separator, action: '' },
        ...[...parsed.tagDefinitions]
            .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
            .map(t => ({
                label: t.name,
                description: t.description,
                action: 'edit',
                tagDef: t
            }))
    ];

    const selected = await vscode.window.showQuickPick(picks, {
        placeHolder: 'Manage tag definitions'
    });

    if (!selected || !selected.action) { return; }

    if (selected.action === 'add') {
        const name = await vscode.window.showInputBox({
            prompt: 'Tag name (alphanumeric and hyphens)',
            validateInput: (value) => {
                if (!value.match(/^[\w-]+$/)) {
                    return 'Tag name must be alphanumeric (hyphens allowed)';
                }
                if (parsed.tagDefinitions.some(t => t.name === value)) {
                    return 'Tag already exists';
                }
                return null;
            }
        });
        if (!name) { return; }

        const desc = await vscode.window.showInputBox({
            prompt: 'Tag description'
        });
        if (!desc) { return; }

        await addTagDefinition(effectiveEditor, name, desc);
    } else if (selected.action === 'edit' && selected.tagDef) {
        const newDesc = await vscode.window.showInputBox({
            prompt: `Edit description for #${selected.tagDef.name}`,
            value: selected.tagDef.description
        });
        if (newDesc === undefined) { return; }

        const line = effectiveDocument.lineAt(selected.tagDef.line);
        const newText = `**${selected.tagDef.name}**: ${newDesc}`;

        await effectiveEditor.edit((editBuilder: vscode.TextEditorEdit) => {
            editBuilder.replace(line.range, newText);
        });

        vscode.window.showInformationMessage(`Updated #${selected.tagDef.name}`);
    }
}

async function addUser(editor: vscode.TextEditor) {
    const ctx = await getEffectiveEditor(editor);
    const effectiveEditor = ctx.editor;
    const effectiveDocument = ctx.document;

    if (!isTodoFile(effectiveDocument)) {
        vscode.window.showWarningMessage('Not a todo file. Add "md-todo: true" to YAML frontmatter.');
        return;
    }

    const parsed = parseDocument(effectiveDocument);

    const shortname = await vscode.window.showInputBox({
        prompt: 'User shortname (used as @shortname)',
        placeHolder: 'e.g. asmith',
        validateInput: (value) => {
            if (!value) { return 'Required'; }
            if (!value.match(/^[\w-]+$/)) { return 'Letters, digits, _ and - only'; }
            if (parsed.userDefinitions.some(u => u.shortname === value)) { return `User @${value} already defined`; }
            return null;
        }
    });
    if (!shortname) { return; }

    const fullname = await vscode.window.showInputBox({
        prompt: 'Full name (optional)',
        placeHolder: 'e.g. Alice Smith'
    });
    if (fullname === undefined) { return; }

    const description = await vscode.window.showInputBox({
        prompt: 'Description',
        placeHolder: 'e.g. frontend lead',
        validateInput: (value) => (value ? null : 'Required')
    });
    if (!description) { return; }

    const fullnamePart = fullname.trim() ? ` (${fullname.trim()})` : '';
    const newLine = `**${shortname}**${fullnamePart}: ${description}`;
    await addUserDefinition(effectiveEditor, shortname, newLine);
}

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
