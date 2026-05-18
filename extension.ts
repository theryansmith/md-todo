import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// ============================================================================
// Types
// ============================================================================

interface TodoItem {
    line: number;
    text: string;
    isComplete: boolean;
    addedDate?: string;
    completedDate?: string;
    notes: string[];
    raw: string;
    indent: number;
    tags: string[];
    mentions: string[];      // @user mentions extracted from content
    children: TodoItem[];    // Nested todo items
    parent?: TodoItem;       // Reference to parent (undefined for top-level)
}

interface TagDefinition {
    name: string;
    description: string;
    line: number;
}

interface UserDefinition {
    shortname: string;
    fullname: string;
    description: string;
    line: number;
}

interface ParsedDocument {
    items: TodoItem[];
    sections: Map<string, { start: number; end: number }>;
    tagDefinitions: TagDefinition[];
    userDefinitions: UserDefinition[];
}

interface TagValidationResult {
    validTags: string[];
    undefinedTags: string[];
}

interface EffectiveEditorContext {
    editor: vscode.TextEditor;
    document: vscode.TextDocument;
}

// ============================================================================
// Utilities
// ============================================================================

function isTodoFile(document: vscode.TextDocument): boolean {
    if (document.languageId !== 'markdown') { return false; }
    if (document.lineCount < 3) { return false; }

    const firstLine = document.lineAt(0).text;
    if (firstLine !== '---') { return false; }

    // Find closing --- and check for md-todo: true
    for (let i = 1; i < Math.min(document.lineCount, 20); i++) {
        const line = document.lineAt(i).text;
        if (line === '---') {
            // Check if md-todo: true exists in frontmatter
            for (let j = 1; j < i; j++) {
                if (document.lineAt(j).text.match(/^md-todo:\s*true/i)) {
                    return true;
                }
            }
            return false;
        }
    }
    return false;
}

function getToday(): string {
    return new Date().toISOString().split('T')[0];
}

function parseDate(dateStr: string): Date | null {
    const match = dateStr.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
        return new Date(parseInt(match[1]), parseInt(match[2]) - 1, parseInt(match[3]));
    }
    return null;
}

function daysBetween(d1: Date, d2: Date): number {
    const oneDay = 24 * 60 * 60 * 1000;
    return Math.round(Math.abs((d1.getTime() - d2.getTime()) / oneDay));
}

function isNoteLine(text: string): boolean {
    // Indented bullet without checkbox (notes don't have checkboxes)
    const hasCheckbox = /^\s+-\s*\[[ xX]\]/.test(text);
    const isIndentedBullet = /^\s+-\s+.+/.test(text);
    return isIndentedBullet && !hasCheckbox;
}

function isNestedTodoLine(text: string): boolean {
    // Indented bullet with checkbox
    return /^\s+-\s*\[[ xX]\]\s*.+$/.test(text);
}

function findItemForSourceLine(sourceLine: number, parsed: ParsedDocument): TodoItem | null {
    // Find the item that owns this source line (either the item itself or a note under it)
    function searchItems(items: TodoItem[]): TodoItem | null {
        for (const item of items) {
            // Direct match - cursor is on the todo item line
            if (item.line === sourceLine) {
                return item;
            }
            // Check if the source line is a note under this item
            // Notes are on lines item.line+1 to item.line+item.notes.length
            if (sourceLine > item.line && sourceLine <= item.line + item.notes.length) {
                return item;
            }
            // Search in children
            const foundInChildren = searchItems(item.children);
            if (foundInChildren) {
                return foundInChildren;
            }
        }
        return null;
    }

    return searchItems(parsed.items);
}

function validateTags(tags: string[], tagDefinitions: TagDefinition[]): TagValidationResult {
    const definedNames = new Set(tagDefinitions.map(t => t.name));
    return {
        validTags: tags.filter(t => definedNames.has(t)),
        undefinedTags: tags.filter(t => !definedNames.has(t))
    };
}

// ============================================================================
// Nested Todo Helpers
// ============================================================================

function isNestedItem(item: TodoItem): boolean {
    return item.parent !== undefined;
}

function getItemWithDescendantsEndLine(document: vscode.TextDocument, item: TodoItem): number {
    let endLine = item.line;
    // Find all consecutive lines belonging to this item (notes + children)
    for (let i = item.line + 1; i < document.lineCount; i++) {
        const lineText = document.lineAt(i).text;
        const lineIndent = lineText.match(/^(\s*)/)?.[1].length ?? 0;
        // Stop if we hit a line with same or less indent that's not empty
        if (lineText.trim() && lineIndent <= item.indent) { break; }
        // Stop at section headers
        if (lineText.startsWith('#')) { break; }
        endLine = i;
    }
    return endLine;
}

function findItemByLine(items: TodoItem[], lineNum: number): TodoItem | null {
    for (const item of items) {
        if (item.line === lineNum) { return item; }
        const found = findItemByLine(item.children, lineNum);
        if (found) { return found; }
    }
    return null;
}

async function getEffectiveEditor(currentEditor: vscode.TextEditor): Promise<EffectiveEditorContext> {
    return { editor: currentEditor, document: currentEditor.document };
}

async function promptCreateTags(editor: vscode.TextEditor, undefinedTags: string[]): Promise<string[]> {
    const createdTags: string[] = [];

    for (const tagName of undefinedTags) {
        const choice = await vscode.window.showQuickPick(
            ['Yes, create it', 'No, skip this tag', 'Cancel all'],
            { placeHolder: `Tag '${tagName}' doesn't exist. Create it?` }
        );

        if (choice === 'Cancel all') { return []; }
        if (choice === 'Yes, create it') {
            const description = await vscode.window.showInputBox({
                prompt: `Enter description for #${tagName}`,
                placeHolder: 'Tag description'
            });
            if (description !== undefined) {
                await addTagDefinition(editor, tagName, description || 'No description');
                createdTags.push(tagName);
            }
        }
    }
    return createdTags;
}

async function processTagsWithValidation(editor: vscode.TextEditor, inputTags: string[]): Promise<string[] | null> {
    const parsed = parseDocument(editor.document);
    const validation = validateTags(inputTags, parsed.tagDefinitions);

    if (validation.undefinedTags.length === 0) { return inputTags; }

    const createdTags = await promptCreateTags(editor, validation.undefinedTags);
    return [...validation.validTags, ...createdTags];
}

// ============================================================================
// Markdown Parsing
// ============================================================================

function parseDocument(document: vscode.TextDocument): ParsedDocument {
    const items: TodoItem[] = [];  // Top-level items only
    const sections = new Map<string, { start: number; end: number }>();

    let currentSection = '';
    let sectionStart = 0;

    // Stack to track parent hierarchy: { item, indent }
    const parentStack: { item: TodoItem; indent: number }[] = [];

    for (let i = 0; i < document.lineCount; i++) {
        const line = document.lineAt(i);
        const text = line.text;

        // Track sections (## headers)
        const sectionMatch = text.match(/^##\s+(.+)$/);
        if (sectionMatch) {
            if (currentSection) {
                sections.set(currentSection.toLowerCase(), { start: sectionStart, end: i - 1 });
            }
            currentSection = sectionMatch[1];
            sectionStart = i;
            parentStack.length = 0;  // Reset stack at section boundaries
            continue;
        }

        // Parse todo items (both top-level and nested)
        const todoMatch = text.match(/^(\s*)-\s*\[([ xX])\]\s*(.+)$/);
        if (todoMatch) {
            const indent = todoMatch[1].length;
            const isComplete = todoMatch[2].toLowerCase() === 'x';
            const content = todoMatch[3];

            // Extract dates from content
            const addedMatch = content.match(/`\+(\d{4}-\d{2}-\d{2})`/);
            const completedMatch = content.match(/`✓(\d{4}-\d{2}-\d{2})`/);

            // Extract tags from content
            const tagMatches = [...content.matchAll(/#([\w-]+)/g)];
            const tags = tagMatches.map(m => m[1]);

            // Extract @mentions from content (independent of tag extraction)
            const mentionMatches = [...content.matchAll(/@([\w-]+)/g)];
            const mentions = mentionMatches.map(m => m[1]);

            const newItem: TodoItem = {
                line: i,
                text: content
                    .replace(/`[+✓]\d{4}-\d{2}-\d{2}`/g, '')
                    .replace(/\s{2,}/g, ' ')
                    .trim(),
                isComplete,
                addedDate: addedMatch ? addedMatch[1] : undefined,
                completedDate: completedMatch ? completedMatch[1] : undefined,
                notes: [],
                raw: text,
                indent,
                tags,
                mentions,
                children: [],
                parent: undefined
            };

            // Pop items from stack with >= indent (find proper parent)
            while (parentStack.length > 0 && parentStack[parentStack.length - 1].indent >= indent) {
                parentStack.pop();
            }

            if (parentStack.length > 0) {
                // Nested todo - attach to parent
                const parentEntry = parentStack[parentStack.length - 1];
                newItem.parent = parentEntry.item;
                parentEntry.item.children.push(newItem);
            } else {
                // Top-level todo
                items.push(newItem);
            }

            // Push this item onto stack as potential parent
            parentStack.push({ item: newItem, indent });
            continue;
        }

        // Parse note lines (indented bullets without checkboxes)
        if (isNoteLine(text) && parentStack.length > 0) {
            const noteIndent = text.match(/^(\s*)/)?.[1].length ?? 0;
            // Attach note to the closest parent with less indentation
            for (let j = parentStack.length - 1; j >= 0; j--) {
                if (parentStack[j].indent < noteIndent) {
                    parentStack[j].item.notes.push(text.trim());
                    break;
                }
            }
            continue;
        }

        // Empty lines or non-matching content reset the stack
        if (!text.trim() || text.startsWith('#')) {
            parentStack.length = 0;
        }
    }

    // Close the last section
    if (currentSection) {
        sections.set(currentSection.toLowerCase(), { start: sectionStart, end: document.lineCount - 1 });
    }

    // Parse tag definitions from ## Tags section
    const tagDefinitions: TagDefinition[] = [];
    const tagsSection = sections.get('tags');
    if (tagsSection) {
        for (let i = tagsSection.start + 1; i <= tagsSection.end; i++) {
            const line = document.lineAt(i).text;
            const match = line.match(/^\*\*([\w-]+)\*\*:\s*(.+)$/);
            if (match) {
                tagDefinitions.push({ name: match[1], description: match[2], line: i });
            }
        }
    }

    // Parse user definitions from ## Users section
    // Format: **shortname** (Full Name): description
    // Group 1: shortname; Group 2: fullname (optional); Group 3: description.
    const userDefinitions: UserDefinition[] = [];
    const usersSection = sections.get('users');
    if (usersSection) {
        for (let i = usersSection.start + 1; i <= usersSection.end; i++) {
            const line = document.lineAt(i).text;
            const match = line.match(/^\*\*([\w-]+)\*\*\s*(?:\(([^)]+)\))?\s*:\s*(.+)$/);
            if (match) {
                userDefinitions.push({
                    shortname: match[1],
                    fullname: match[2] ?? '',
                    description: match[3],
                    line: i
                });
            }
        }
    }

    // Sort definitions once at the source so every consumer (QuickPick
    // suggestion lists in promptForTodoText, completion providers, tree views,
    // status-bar pickers, etc.) sees the same canonical alphabetical order.
    // Case-insensitive via sensitivity: 'base'.
    tagDefinitions.sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    userDefinitions.sort((a, b) =>
        a.shortname.localeCompare(b.shortname, undefined, { sensitivity: 'base' }));

    return { items, sections, tagDefinitions, userDefinitions };
}

function findItemAtCursor(editor: vscode.TextEditor): { item: TodoItem; lineNum: number } | null {
    const document = editor.document;
    const cursorLine = editor.selection.active.line;
    const parsed = parseDocument(document);

    // Look for a todo item at or above cursor
    for (let i = cursorLine; i >= 0; i--) {
        const line = document.lineAt(i);
        const match = line.text.match(/^(\s*)-\s*\[([ xX])\]\s*(.+)$/);
        if (match) {
            // Search through all items including nested ones
            const item = findItemByLine(parsed.items, i);
            if (item) {
                return { item, lineNum: i };
            }
        }
        // Stop if we hit a section header or blank line followed by non-note content
        if (line.text.startsWith('#') || (line.text.trim() === '' && i < cursorLine - 1)) {
            break;
        }
    }
    return null;
}

function getItemEndLine(document: vscode.TextDocument, startLine: number): number {
    // Find where this item's content ends (notes and nested todos)
    const startText = document.lineAt(startLine).text;
    const startIndent = startText.match(/^(\s*)/)?.[1].length ?? 0;

    for (let i = startLine + 1; i < document.lineCount; i++) {
        const line = document.lineAt(i).text;
        if (!line.trim()) { continue; }  // Skip blank lines
        if (line.startsWith('#')) { return i - 1; }  // Section header

        const lineIndent = line.match(/^(\s*)/)?.[1].length ?? 0;
        // If we hit a line with same or less indent that's a todo, we're done
        if (lineIndent <= startIndent && /^\s*-\s*\[[ xX]\]/.test(line)) {
            return i - 1;
        }
        // If it's a note or nested todo with greater indent, continue
        if (isNoteLine(line) || isNestedTodoLine(line)) {
            continue;
        }
        // Otherwise, we've found the end
        return i - 1;
    }
    return document.lineCount - 1;
}

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

async function markDone(editor: vscode.TextEditor, _edit?: vscode.TextEditorEdit, targetLine?: number) {
    // Get effective editor (handles filtered views)
    const ctx = await getEffectiveEditor(editor);
    const effectiveEditor = ctx.editor;
    const effectiveDocument = ctx.document;

    if (!isTodoFile(effectiveDocument)) {
        vscode.window.showWarningMessage('Not a todo file. Add "md-todo: true" to YAML frontmatter.');
        return;
    }

    let result: { item: TodoItem; lineNum: number } | null = null;

    // If targetLine was provided (e.g. from tree view), look it up directly
    if (targetLine !== undefined) {
        const parsed = parseDocument(effectiveDocument);
        const item = findItemForSourceLine(targetLine, parsed);
        if (item) {
            result = { item, lineNum: item.line };
        }
    } else {
        result = findItemAtCursor(effectiveEditor);
    }

    if (!result) {
        // No item at cursor, show picker
        const parsed = parseDocument(effectiveDocument);
        const incompleteItems = parsed.items.filter(item => !item.isComplete);

        if (incompleteItems.length === 0) {
            vscode.window.showInformationMessage('No incomplete items found');
            return;
        }

        const picks = incompleteItems.map((item, idx) => ({
            label: item.text,
            description: item.addedDate ? `Added ${item.addedDate}` : '',
            item
        }));

        const selected = await vscode.window.showQuickPick(picks, {
            placeHolder: 'Select item to mark complete'
        });

        if (!selected) { return; }

        await markItemDone(effectiveEditor, selected.item);
    } else {
        if (result.item.isComplete) {
            vscode.window.showInformationMessage('Item is already complete');
            return;
        }
        await markItemDone(effectiveEditor, result.item);
    }
}

async function markItemDone(editor: vscode.TextEditor, item: TodoItem) {
    const document = editor.document;
    const today = getToday();

    // Helper to mark a line as complete (add [x] and completion date)
    function markLineComplete(lineText: string): string {
        let result = lineText;
        // Change [ ] to [x] if not already done
        result = result.replace(/\[\s\]/, '[x]');
        // Add completion date if not present
        if (!result.includes('`✓')) {
            if (result.includes('`+')) {
                result = result.replace(/(`\+\d{4}-\d{2}-\d{2}`)/, `$1 \`✓${today}\``);
            } else {
                result = result.trimEnd() + ` \`✓${today}\``;
            }
        }
        return result;
    }

    // Find the Completed section
    const parsed = parseDocument(document);
    const completedSection = parsed.sections.get('completed');

    // Get all lines for this item and its descendants, marking todos as complete
    const endLine = getItemWithDescendantsEndLine(document, item);
    const itemLines: string[] = [];

    for (let i = item.line; i <= endLine; i++) {
        const lineText = document.lineAt(i).text;
        // Check if this line is a todo (has checkbox)
        if (/^\s*-\s*\[[ xX]\]/.test(lineText)) {
            itemLines.push(markLineComplete(lineText));
        } else {
            itemLines.push(lineText);  // Notes stay as-is
        }
    }

    // CASE 1: Nested todo (has parent) - update in place with children, don't move
    if (isNestedItem(item)) {
        await editor.edit((editBuilder: vscode.TextEditorEdit) => {
            const range = new vscode.Range(item.line, 0, endLine, document.lineAt(endLine).text.length);
            editBuilder.replace(range, itemLines.join('\n'));
        });
        vscode.window.showInformationMessage(`Completed: ${item.text}`);
        return;
    }

    // CASE 2: No Completed section - just update in place
    if (!completedSection) {
        await editor.edit((editBuilder: vscode.TextEditorEdit) => {
            const range = new vscode.Range(item.line, 0, endLine, document.lineAt(endLine).text.length);
            editBuilder.replace(range, itemLines.join('\n'));
        });
        vscode.window.showInformationMessage(`Completed: ${item.text}`);
        return;
    }

    // CASE 3: Already in Completed section - just update in place
    if (item.line >= completedSection.start && item.line <= completedSection.end) {
        await editor.edit((editBuilder: vscode.TextEditorEdit) => {
            const range = new vscode.Range(item.line, 0, endLine, document.lineAt(endLine).text.length);
            editBuilder.replace(range, itemLines.join('\n'));
        });
        vscode.window.showInformationMessage(`Completed: ${item.text}`);
        return;
    }

    // CASE 4: Top-level todo - move entire tree (with all children marked complete) to Completed
    // Delete the original item and all its content
    const deleteStart = item.line;
    const deleteEnd = endLine + 1;

    await editor.edit((editBuilder: vscode.TextEditorEdit) => {
        const deleteRange = new vscode.Range(deleteStart, 0, deleteEnd, 0);
        editBuilder.delete(deleteRange);
    });

    // Re-parse document after deletion to get correct positions
    const updatedDoc = editor.document;
    const updatedParsed = parseDocument(updatedDoc);
    const updatedCompletedSection = updatedParsed.sections.get('completed');

    if (!updatedCompletedSection) {
        // Completed section disappeared somehow - shouldn't happen
        vscode.window.showInformationMessage(`Completed: ${item.text}`);
        return;
    }

    // Find insert position: right after header, check for blank line
    const lineAfterHeader = updatedCompletedSection.start + 1;
    const hasBlankAfterHeader = lineAfterHeader < updatedDoc.lineCount &&
        updatedDoc.lineAt(lineAfterHeader).text.trim() === '';

    // Build insert text
    let insertText = itemLines.join('\n') + '\n';
    const insertLine = hasBlankAfterHeader
        ? updatedCompletedSection.start + 2  // After header + existing blank
        : updatedCompletedSection.start + 1; // Right after header, add blank

    if (!hasBlankAfterHeader) {
        insertText = '\n' + insertText;
    }

    // Insert at top of Completed section
    await editor.edit((editBuilder: vscode.TextEditorEdit) => {
        editBuilder.insert(new vscode.Position(insertLine, 0), insertText);
    });

    vscode.window.showInformationMessage(`Completed: ${item.text}`);
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

async function addTagDefinition(editor: vscode.TextEditor, name: string, description: string) {
    const document = editor.document;
    const parsed = parseDocument(document);
    const tagsSection = parsed.sections.get('tags');

    const newLine = `**${name}**: ${description}`;

    if (tagsSection) {
        // Insert at start of tags section (after header)
        let insertLine = tagsSection.start + 1;
        // Skip blank lines
        while (insertLine < document.lineCount && document.lineAt(insertLine).text.trim() === '') {
            insertLine++;
        }

        await editor.edit((editBuilder: vscode.TextEditorEdit) => {
            editBuilder.insert(new vscode.Position(insertLine, 0), newLine + '\n');
        });
    } else {
        // Create ## Tags section at the end of the document
        const insertLine = document.lineCount;

        await editor.edit((editBuilder: vscode.TextEditorEdit) => {
            const text = `\n## Tags\n\n${newLine}\n`;
            editBuilder.insert(new vscode.Position(insertLine, 0), text);
        });
    }

    vscode.window.showInformationMessage(`Added tag: #${name}`);
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

async function addUserDefinition(editor: vscode.TextEditor, shortname: string, newLine: string) {
    const document = editor.document;
    const parsed = parseDocument(document);
    const usersSection = parsed.sections.get('users');

    if (usersSection) {
        let insertLine = usersSection.start + 1;
        while (insertLine < document.lineCount && document.lineAt(insertLine).text.trim() === '') {
            insertLine++;
        }
        await editor.edit((editBuilder: vscode.TextEditorEdit) => {
            editBuilder.insert(new vscode.Position(insertLine, 0), newLine + '\n');
        });
    } else {
        const insertLine = document.lineCount;
        await editor.edit((editBuilder: vscode.TextEditorEdit) => {
            const text = `\n## Users\n\n${newLine}\n`;
            editBuilder.insert(new vscode.Position(insertLine, 0), text);
        });
    }

    vscode.window.showInformationMessage(`Added user: @${shortname}`);
}

// ============================================================================
// Tag Decorations
// ============================================================================

let tagDecorationType: vscode.TextEditorDecorationType | undefined;

function createTagDecorationType(): vscode.TextEditorDecorationType {
    // Dispose old decoration type if it exists
    if (tagDecorationType) {
        tagDecorationType.dispose();
    }

    // Distinct, visible color for tags (purple). Less prominent than @mentions
    // (which are bold + charts.blue), but clearly stands out from body text.
    tagDecorationType = vscode.window.createTextEditorDecorationType({
        color: new vscode.ThemeColor('charts.purple')
    });

    return tagDecorationType;
}

function updateTagDecorations(editor: vscode.TextEditor) {
    // Ensure decoration type exists
    const decorationType = tagDecorationType ?? createTagDecorationType();

    if (!isTodoFile(editor.document)) {
        editor.setDecorations(decorationType, []);
        return;
    }

    const decorations: vscode.DecorationOptions[] = [];

    for (let i = 0; i < editor.document.lineCount; i++) {
        const line = editor.document.lineAt(i);
        const matches = [...line.text.matchAll(/#[\w-]+/g)];

        for (const match of matches) {
            if (match.index !== undefined) {
                decorations.push({
                    range: new vscode.Range(i, match.index, i, match.index + match[0].length)
                });
            }
        }
    }

    editor.setDecorations(decorationType, decorations);
}

// ============================================================================
// Date Decorations
// ============================================================================

let dateDecorationType: vscode.TextEditorDecorationType | undefined;

function createDateDecorationType(): vscode.TextEditorDecorationType {
    const config = vscode.workspace.getConfiguration('mdTodo');
    const opacity = config.get<number>('dateOpacity', 0.5);

    // Dispose old decoration type if it exists
    if (dateDecorationType) {
        dateDecorationType.dispose();
    }

    dateDecorationType = vscode.window.createTextEditorDecorationType({
        opacity: String(opacity)
    });

    return dateDecorationType;
}

function updateDateDecorations(editor: vscode.TextEditor) {
    // Ensure decoration type exists
    const decorationType = dateDecorationType ?? createDateDecorationType();

    if (!isTodoFile(editor.document)) {
        editor.setDecorations(decorationType, []);
        return;
    }

    const decorations: vscode.DecorationOptions[] = [];

    // Match date patterns: `+YYYY-MM-DD` and `✓YYYY-MM-DD`
    const datePattern = /`[+✓]\d{4}-\d{2}-\d{2}`/g;

    for (let i = 0; i < editor.document.lineCount; i++) {
        const line = editor.document.lineAt(i);
        const matches = [...line.text.matchAll(datePattern)];

        for (const match of matches) {
            if (match.index !== undefined) {
                decorations.push({
                    range: new vscode.Range(i, match.index, i, match.index + match[0].length)
                });
            }
        }
    }

    editor.setDecorations(decorationType, decorations);
}

// ============================================================================
// Mention Decorations (@user references)
// ============================================================================

let mentionDecorationType: vscode.TextEditorDecorationType | undefined;

function createMentionDecorationType(): vscode.TextEditorDecorationType {
    if (mentionDecorationType) {
        mentionDecorationType.dispose();
    }
    // Distinct styling from tag decorations: bold + accent color (charts.blue)
    mentionDecorationType = vscode.window.createTextEditorDecorationType({
        color: new vscode.ThemeColor('charts.blue'),
        fontWeight: 'bold'
    });
    return mentionDecorationType;
}

function updateMentionDecorations(editor: vscode.TextEditor) {
    const decorationType = mentionDecorationType ?? createMentionDecorationType();

    if (!isTodoFile(editor.document)) {
        editor.setDecorations(decorationType, []);
        return;
    }

    const decorations: vscode.DecorationOptions[] = [];
    for (let i = 0; i < editor.document.lineCount; i++) {
        const line = editor.document.lineAt(i);
        const matches = [...line.text.matchAll(/@[\w-]+/g)];
        for (const match of matches) {
            if (match.index !== undefined) {
                decorations.push({
                    range: new vscode.Range(i, match.index, i, match.index + match[0].length)
                });
            }
        }
    }
    editor.setDecorations(decorationType, decorations);
}

// ============================================================================
// Focus User: state, status bar, dimming decorations (Variant C)
// ============================================================================

const FOCUS_USER_STATE_KEY = 'mdTodo.focusUser';
const FOCUS_TAG_STATE_KEY = 'mdTodo.focusTag';
const ACTIVITY_FOCUS_STATE_KEY = 'mdTodo.activityFocus';
const LAST_TODO_URI_STATE_KEY = 'mdTodo.completion.lastTodoFileUri';

let focusStatusBarItem: vscode.StatusBarItem | undefined;
let tagFocusStatusBarItem: vscode.StatusBarItem | undefined;
let activityFocusStatusBarItem: vscode.StatusBarItem | undefined;
let dimmedDecorationType: vscode.TextEditorDecorationType | undefined;
// Module-level reference so commands and event handlers can read/write the
// per-workspace focus user without threading context everywhere.
let extensionContext: vscode.ExtensionContext | undefined;

function getFocusUser(): string | undefined {
    return extensionContext?.workspaceState.get<string>(FOCUS_USER_STATE_KEY);
}

async function setFocusUserState(shortname: string | undefined): Promise<void> {
    if (!extensionContext) { return; }
    await extensionContext.workspaceState.update(FOCUS_USER_STATE_KEY, shortname);
}

function getFocusTag(): string | undefined {
    return extensionContext?.workspaceState.get<string>(FOCUS_TAG_STATE_KEY);
}

async function setFocusTagState(tagname: string | undefined): Promise<void> {
    if (!extensionContext) { return; }
    await extensionContext.workspaceState.update(FOCUS_TAG_STATE_KEY, tagname);
}

// Records the URI of the most recently active mdtodo document so that
// completion providers can source tags/users from it even when the
// active editor is a non-mdtodo file.
let lastTodoUri: vscode.Uri | undefined;

function rememberLastTodoUri(uri: vscode.Uri): void {
    lastTodoUri = uri;
    extensionContext?.workspaceState.update(LAST_TODO_URI_STATE_KEY, uri.toString());
}

async function getLastTodoSourceDoc(): Promise<vscode.TextDocument | undefined> {
    let uri = lastTodoUri;
    if (!uri) {
        const stored = extensionContext?.workspaceState.get<string>(LAST_TODO_URI_STATE_KEY);
        if (!stored) { return undefined; }
        try { uri = vscode.Uri.parse(stored); } catch { return undefined; }
        lastTodoUri = uri;
    }
    try {
        const doc = await vscode.workspace.openTextDocument(uri);
        return isTodoFile(doc) ? doc : undefined;
    } catch {
        return undefined;
    }
}

function createDimmedDecorationType(): vscode.TextEditorDecorationType {
    if (dimmedDecorationType) {
        dimmedDecorationType.dispose();
    }
    dimmedDecorationType = vscode.window.createTextEditorDecorationType({
        opacity: '0.25'
    });
    return dimmedDecorationType;
}

function refreshFocusStatusBar(editor: vscode.TextEditor | undefined) {
    if (!focusStatusBarItem) { return; }

    // Only show on todo files
    if (!editor || !isTodoFile(editor.document)) {
        focusStatusBarItem.hide();
        return;
    }

    const focus = getFocusUser();
    if (!focus) {
        focusStatusBarItem.text = '$(person) All users';
        focusStatusBarItem.tooltip = 'No user focus — click to focus on a user';
    } else {
        // Look up fullname for tooltip
        const parsed = parseDocument(editor.document);
        const userDef = parsed.userDefinitions.find(u => u.shortname === focus);
        const display = userDef?.fullname || focus;
        focusStatusBarItem.text = `$(person) @${focus}`;
        focusStatusBarItem.tooltip = `Focused on ${display} — click to change`;
    }
    focusStatusBarItem.show();
}

function refreshFocusTagStatusBar(editor: vscode.TextEditor | undefined) {
    if (!tagFocusStatusBarItem) { return; }
    if (!editor || !isTodoFile(editor.document)) {
        tagFocusStatusBarItem.hide();
        return;
    }
    const focus = getFocusTag();
    if (!focus) {
        tagFocusStatusBarItem.text = '$(tag) All tags';
        tagFocusStatusBarItem.tooltip = 'No tag focus — click to focus on a tag';
    } else {
        tagFocusStatusBarItem.text = `$(tag) #${focus}`;
        tagFocusStatusBarItem.tooltip = `Focused on #${focus} — click to change`;
    }
    tagFocusStatusBarItem.show();
}

/**
 * Dim every line that does NOT belong to a top-level item whose subtree
 * matches the active focus filters.
 *
 * A top-level item is "matched" when its subtree contains at least one node
 * (the item itself or any descendant) that satisfies BOTH the user-focus and
 * tag-focus filters. Either filter alone behaves as before; both set together
 * narrows the visible items via AND semantics. When unmatched, the entire
 * subtree (including notes) is dimmed. When matched, nothing in the subtree
 * is dimmed so the user can read the parent context.
 */
function updateDimDecorations(editor: vscode.TextEditor) {
    const decorationType = dimmedDecorationType ?? createDimmedDecorationType();
    if (!isTodoFile(editor.document)) {
        editor.setDecorations(decorationType, []);
        return;
    }
    const focusUser = getFocusUser();
    const focusTag = getFocusTag();
    const activity = getActivityFocus();
    if (!focusUser && !focusTag && !activity) {
        editor.setDecorations(decorationType, []);
        return;
    }
    const parsed = parseDocument(editor.document);
    const today = startOfToday();

    function subtreeMatches(item: TodoItem): boolean {
        const userOk = !focusUser || item.mentions.includes(focusUser);
        const tagOk = !focusTag || item.tags.includes(focusTag);
        const activityOk = !activity || itemMatchesActivity(item, activity, today);
        if (userOk && tagOk && activityOk) { return true; }
        for (const child of item.children) {
            if (subtreeMatches(child)) { return true; }
        }
        return false;
    }

    const ranges: vscode.Range[] = [];

    // (a) Subtree-level dim for non-matching top-level subtrees.
    for (const top of parsed.items) {
        if (subtreeMatches(top)) { continue; }
        const endLine = getItemWithDescendantsEndLine(editor.document, top);
        const endLineLength = editor.document.lineAt(endLine).text.length;
        ranges.push(new vscode.Range(top.line, 0, endLine, endLineLength));
    }

    // (b) Span-level dim across the whole document. Already-dimmed spans from
    //     (a) ride along harmlessly (idempotent).
    for (let i = 0; i < editor.document.lineCount; i++) {
        const lineText = editor.document.lineAt(i).text;
        if (focusUser) {
            for (const m of lineText.matchAll(/@([\w-]+)/g)) {
                if (m.index !== undefined && m[1] !== focusUser) {
                    ranges.push(new vscode.Range(i, m.index, i, m.index + m[0].length));
                }
            }
        }
        if (focusTag) {
            for (const m of lineText.matchAll(/#([\w-]+)/g)) {
                if (m.index !== undefined && m[1] !== focusTag) {
                    ranges.push(new vscode.Range(i, m.index, i, m.index + m[0].length));
                }
            }
        }
    }

    editor.setDecorations(decorationType, ranges);
}

// ============================================================================
// Activity Focus: state, picker, decoration predicate, status bar
// ============================================================================

type ActivityKind = 'completed' | 'added' | 'stale';

interface ActivityFocus {
    kind: ActivityKind;
    startDate?: string;   // ISO YYYY-MM-DD, inclusive (completed/added)
    endDate?: string;     // ISO YYYY-MM-DD, inclusive (completed/added)
    staleDays?: number;   // for kind === 'stale'
    label: string;        // human-readable for status bar
}

function getActivityFocus(): ActivityFocus | undefined {
    return extensionContext?.workspaceState.get<ActivityFocus>(ACTIVITY_FOCUS_STATE_KEY);
}

async function setActivityFocusState(focus: ActivityFocus | undefined): Promise<void> {
    if (!extensionContext) { return; }
    await extensionContext.workspaceState.update(ACTIVITY_FOCUS_STATE_KEY, focus);
}

function refreshActivityFocusStatusBar(editor: vscode.TextEditor | undefined) {
    if (!activityFocusStatusBarItem) { return; }
    if (!editor || !isTodoFile(editor.document)) {
        activityFocusStatusBarItem.hide();
        return;
    }
    const focus = getActivityFocus();
    if (!focus) {
        activityFocusStatusBarItem.text = '$(calendar) All time';
        activityFocusStatusBarItem.tooltip = 'No activity focus — click to filter by date';
    } else {
        const prefix = focus.kind === 'completed' ? 'Completed'
            : focus.kind === 'added' ? 'Added'
            : 'Stale';
        activityFocusStatusBarItem.text = `$(calendar) ${prefix}: ${focus.label}`;
        activityFocusStatusBarItem.tooltip = `Activity focus: ${prefix} (${focus.label}) — click to change`;
    }
    activityFocusStatusBarItem.show();
}

function refreshAllActivityUI() {
    for (const v of vscode.window.visibleTextEditors) {
        if (isTodoFile(v.document)) { updateDimDecorations(v); }
    }
    refreshActivityFocusStatusBar(vscode.window.activeTextEditor);
}

// ----- Date helpers (local to activity reports) -----

function formatIsoDate(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function startOfToday(): Date {
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    return t;
}

function isDateInRange(d: Date, startIso: string, endIso: string): boolean {
    const dIso = formatIsoDate(d);
    return dIso >= startIso && dIso <= endIso;
}

function itemMatchesActivity(item: TodoItem, activity: ActivityFocus, today: Date): boolean {
    if (activity.kind === 'completed') {
        if (!item.completedDate) { return false; }
        const d = parseDate(item.completedDate);
        if (!d) { return false; }
        return isDateInRange(d, activity.startDate!, activity.endDate!);
    }
    if (activity.kind === 'added') {
        if (!item.addedDate) { return false; }
        const d = parseDate(item.addedDate);
        if (!d) { return false; }
        return isDateInRange(d, activity.startDate!, activity.endDate!);
    }
    // stale: incomplete + added at least staleDays ago
    if (item.isComplete || !item.addedDate) { return false; }
    const d = parseDate(item.addedDate);
    if (!d) { return false; }
    return daysBetween(today, d) >= (activity.staleDays ?? 0);
}

// ----- Natural-language date range parser -----

function parseNaturalDateRange(input: string): { start: string; end: string; label: string } | null {
    const s = input.trim().toLowerCase();
    if (!s) { return null; }
    const today = startOfToday();
    const todayIso = formatIsoDate(today);

    if (s === 'today') {
        return { start: todayIso, end: todayIso, label: 'today' };
    }
    if (s === 'yesterday') {
        const y = new Date(today); y.setDate(y.getDate() - 1);
        const yIso = formatIsoDate(y);
        return { start: yIso, end: yIso, label: 'yesterday' };
    }
    if (s === 'last week') {
        const start = new Date(today); start.setDate(start.getDate() - 7);
        return { start: formatIsoDate(start), end: todayIso, label: 'last week' };
    }
    if (s === 'last month') {
        const start = new Date(today); start.setDate(start.getDate() - 30);
        return { start: formatIsoDate(start), end: todayIso, label: 'last month' };
    }
    if (s === 'this week') {
        const day = today.getDay() || 7;   // Sun=0 → 7
        const monday = new Date(today); monday.setDate(monday.getDate() - (day - 1));
        return { start: formatIsoDate(monday), end: todayIso, label: 'this week' };
    }
    if (s === 'this month') {
        const first = new Date(today.getFullYear(), today.getMonth(), 1);
        return { start: formatIsoDate(first), end: todayIso, label: 'this month' };
    }

    let m = s.match(/^last\s+(\d+)\s+(day|days|week|weeks|month|months)$/);
    if (m) {
        const n = parseInt(m[1], 10);
        const unit = m[2];
        let daysBack = n;
        if (unit.startsWith('week')) { daysBack = n * 7; }
        else if (unit.startsWith('month')) { daysBack = n * 30; }
        const start = new Date(today); start.setDate(start.getDate() - daysBack);
        return { start: formatIsoDate(start), end: todayIso, label: `last ${n} ${unit}` };
    }

    m = s.match(/^(\d{4}-\d{2}-\d{2})$/);
    if (m) { return { start: m[1], end: m[1], label: m[1] }; }

    m = s.match(/^(\d{4}-\d{2}-\d{2})\s+to\s+(\d{4}-\d{2}-\d{2})$/);
    if (m) {
        const [s1, s2] = m[1] <= m[2] ? [m[1], m[2]] : [m[2], m[1]];
        return { start: s1, end: s2, label: `${s1} → ${s2}` };
    }

    return null;
}

// ----- Pickers -----

async function pickDateRange(kind: 'completed' | 'added'): Promise<{ start: string; end: string; label: string } | undefined> {
    type RangeItem = vscode.QuickPickItem & {
        builder?: () => { start: string; end: string; label: string };
        isCustom?: boolean;
    };
    const presets: RangeItem[] = [
        { label: 'Today', builder: () => parseNaturalDateRange('today')! },
        { label: 'Yesterday', builder: () => parseNaturalDateRange('yesterday')! },
        { label: 'Last 7 days', builder: () => parseNaturalDateRange('last 7 days')! },
        { label: 'Last 30 days', builder: () => parseNaturalDateRange('last 30 days')! },
        { label: 'This week', description: 'Mon–today', builder: () => parseNaturalDateRange('this week')! },
        { label: 'This month', description: '1st–today', builder: () => parseNaturalDateRange('this month')! },
        { label: 'Last month', description: '~30 days', builder: () => parseNaturalDateRange('last month')! },
        { label: 'Custom…', description: 'last N days/weeks/months · today · yesterday · YYYY-MM-DD · YYYY-MM-DD to YYYY-MM-DD', isCustom: true },
    ];
    const picked = await vscode.window.showQuickPick(presets, {
        placeHolder: `Pick a date range — ${kind === 'completed' ? 'Recently Completed' : 'Recently Added'}`,
        matchOnDescription: true
    });
    if (!picked) { return undefined; }
    if (picked.isCustom) {
        const input = await vscode.window.showInputBox({
            prompt: 'Enter date range',
            placeHolder: 'last 7 days, last 2 weeks, today, yesterday, YYYY-MM-DD, YYYY-MM-DD to YYYY-MM-DD',
            validateInput: v => parseNaturalDateRange(v) ? null : 'Could not parse. Try: last 7 days, last 2 weeks, today, YYYY-MM-DD, etc.'
        });
        if (!input) { return undefined; }
        return parseNaturalDateRange(input)!;
    }
    return picked.builder!();
}

async function pickStaleThreshold(): Promise<{ days: number; label: string } | undefined> {
    type StaleItem = vscode.QuickPickItem & { days?: number; isCustom?: boolean };
    const defaultDays = vscode.workspace.getConfiguration('mdTodo').get<number>('staleAfterDays') ?? 30;
    const baseDays = [7, 14, defaultDays, 60, 90];
    const seen = new Set<number>();
    const presets: StaleItem[] = [];
    for (const d of baseDays) {
        if (seen.has(d)) { continue; }
        seen.add(d);
        presets.push({
            label: `${d} days`,
            description: d === defaultDays ? '(default from settings)' : undefined,
            days: d
        });
    }
    presets.push({ label: 'Custom…', description: 'enter a number', isCustom: true });

    const picked = await vscode.window.showQuickPick(presets, {
        placeHolder: 'Pick a staleness threshold (incomplete items older than N days)'
    });
    if (!picked) { return undefined; }
    if (picked.isCustom) {
        const input = await vscode.window.showInputBox({
            prompt: 'Stale threshold (days)',
            placeHolder: String(defaultDays),
            validateInput: v => /^\d+$/.test(v) && parseInt(v, 10) > 0 ? null : 'Enter a positive integer'
        });
        if (!input) { return undefined; }
        const n = parseInt(input, 10);
        return { days: n, label: `older than ${n} days` };
    }
    return { days: picked.days!, label: `older than ${picked.days} days` };
}

// ----- Report buffer renderer -----

async function openActivityReport(
    document: vscode.TextDocument,
    activity: ActivityFocus
) {
    const parsed = parseDocument(document);
    const today = startOfToday();

    // Flatten all items + descendants.
    const allItems: TodoItem[] = [];
    function walk(item: TodoItem) {
        allItems.push(item);
        for (const c of item.children) { walk(c); }
    }
    for (const top of parsed.items) { walk(top); }

    const matched = allItems.filter(item => itemMatchesActivity(item, activity, today));

    const lines: string[] = [];

    if (activity.kind === 'completed') {
        lines.push(`# 📅 Recently Completed — ${activity.label}`);
        lines.push('');
        lines.push(`**Range:** ${activity.startDate} → ${activity.endDate}`);
        lines.push(`**Total:** ${matched.length} items completed`);
        lines.push('');
        const groups = new Map<string, TodoItem[]>();
        for (const item of matched) {
            const k = item.completedDate || 'unknown';
            if (!groups.has(k)) { groups.set(k, []); }
            groups.get(k)!.push(item);
        }
        const dates = [...groups.keys()].sort().reverse();
        for (const d of dates) {
            const items = groups.get(d)!;
            lines.push(`## ${d} (${items.length})`);
            for (const item of items) {
                let info = '';
                if (item.addedDate && item.completedDate) {
                    const a = parseDate(item.addedDate);
                    const c = parseDate(item.completedDate);
                    if (a && c) { info = ` — added ${item.addedDate}, completed in ${daysBetween(c, a)} days`; }
                }
                lines.push(`- ${item.text}${info}`);
            }
            lines.push('');
        }
    } else if (activity.kind === 'added') {
        lines.push(`# 📅 Recently Added — ${activity.label}`);
        lines.push('');
        lines.push(`**Range:** ${activity.startDate} → ${activity.endDate}`);
        lines.push(`**Total:** ${matched.length} items added`);
        lines.push('');
        const groups = new Map<string, TodoItem[]>();
        for (const item of matched) {
            const k = item.addedDate || 'unknown';
            if (!groups.has(k)) { groups.set(k, []); }
            groups.get(k)!.push(item);
        }
        const dates = [...groups.keys()].sort().reverse();
        for (const d of dates) {
            const items = groups.get(d)!;
            lines.push(`## ${d} (${items.length})`);
            for (const item of items) {
                const status = item.isComplete
                    ? ` — ✓ completed${item.completedDate ? ' ' + item.completedDate : ''}`
                    : '';
                lines.push(`- ${item.text}${status}`);
            }
            lines.push('');
        }
    } else {
        lines.push(`# 📅 Stale Items — ${activity.label}`);
        lines.push('');
        lines.push(`**Total:** ${matched.length} incomplete items older than ${activity.staleDays} days`);
        lines.push('');
        const withAge = matched.map(item => ({
            item,
            age: item.addedDate && parseDate(item.addedDate)
                ? daysBetween(today, parseDate(item.addedDate)!)
                : Infinity
        }));
        withAge.sort((a, b) => b.age - a.age);
        for (const { item, age } of withAge) {
            const ageStr = age === Infinity ? 'unknown age' : `${age} days old`;
            lines.push(`- (${ageStr}) ${item.text}`);
        }
    }

    if (matched.length === 0) {
        lines.push('_(no matching items)_');
    }

    const doc = await vscode.workspace.openTextDocument({
        content: lines.join('\n'),
        language: 'markdown'
    });
    await vscode.window.showTextDocument(doc, {
        preview: true,
        viewColumn: vscode.ViewColumn.Beside
    });
}

// ----- Commands -----

async function showRecentlyCompleted(editor: vscode.TextEditor) {
    const ctx = await getEffectiveEditor(editor);
    if (!isTodoFile(ctx.document)) {
        vscode.window.showWarningMessage('Not a todo file. Add "md-todo: true" to YAML frontmatter.');
        return;
    }
    const range = await pickDateRange('completed');
    if (!range) { return; }
    const focus: ActivityFocus = { kind: 'completed', startDate: range.start, endDate: range.end, label: range.label };
    await setActivityFocusState(focus);
    refreshAllActivityUI();
    await openActivityReport(ctx.document, focus);
}

async function showRecentlyAdded(editor: vscode.TextEditor) {
    const ctx = await getEffectiveEditor(editor);
    if (!isTodoFile(ctx.document)) {
        vscode.window.showWarningMessage('Not a todo file. Add "md-todo: true" to YAML frontmatter.');
        return;
    }
    const range = await pickDateRange('added');
    if (!range) { return; }
    const focus: ActivityFocus = { kind: 'added', startDate: range.start, endDate: range.end, label: range.label };
    await setActivityFocusState(focus);
    refreshAllActivityUI();
    await openActivityReport(ctx.document, focus);
}

async function showStaleItems(editor: vscode.TextEditor) {
    const ctx = await getEffectiveEditor(editor);
    if (!isTodoFile(ctx.document)) {
        vscode.window.showWarningMessage('Not a todo file. Add "md-todo: true" to YAML frontmatter.');
        return;
    }
    const threshold = await pickStaleThreshold();
    if (!threshold) { return; }
    const focus: ActivityFocus = { kind: 'stale', staleDays: threshold.days, label: threshold.label };
    await setActivityFocusState(focus);
    refreshAllActivityUI();
    await openActivityReport(ctx.document, focus);
}

async function clearActivityFocus(): Promise<void> {
    await setActivityFocusState(undefined);
    refreshAllActivityUI();
}

async function activityFocusMenu(): Promise<void> {
    type Cmd = vscode.QuickPickItem & { command: string };
    const items: Cmd[] = [
        { label: '$(calendar) Show Recently Completed', command: 'mdTodo.showRecentlyCompleted' },
        { label: '$(calendar) Show Recently Added', command: 'mdTodo.showRecentlyAdded' },
        { label: '$(calendar) Show Stale Items', command: 'mdTodo.showStaleItems' },
        { label: '$(circle-slash) Clear Activity Focus', command: 'mdTodo.clearActivityFocus' },
    ];
    const picked = await vscode.window.showQuickPick(items, { placeHolder: 'Activity focus' });
    if (!picked) { return; }
    await vscode.commands.executeCommand(picked.command);
}

// ============================================================================
// Focus User: commands
// ============================================================================

async function setFocusUser(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage('Open a todo file first');
        return;
    }
    const ctx = await getEffectiveEditor(editor);
    if (!isTodoFile(ctx.document)) {
        vscode.window.showWarningMessage('Not a todo file. Add "md-todo: true" to YAML frontmatter.');
        return;
    }

    const parsed = parseDocument(ctx.document);

    type FocusPick = vscode.QuickPickItem & { shortname: string | undefined };
    const picks: FocusPick[] = [
        { label: '$(circle-slash) Clear focus', description: 'Show all users', shortname: undefined },
        ...[...parsed.userDefinitions]
            .sort((a, b) => a.shortname.localeCompare(b.shortname, undefined, { sensitivity: 'base' }))
            .map<FocusPick>(u => ({
                label: `$(person) @${u.shortname}`,
                description: u.fullname,
                detail: u.description,
                shortname: u.shortname
            }))
    ];

    if (parsed.userDefinitions.length === 0) {
        vscode.window.showInformationMessage('No users defined. Add a "## Users" section first.');
    }

    const current = getFocusUser();
    const placeHolder = current
        ? `Currently focused on @${current}`
        : 'Select a user to focus on (or clear)';

    const picked = await vscode.window.showQuickPick(picks, {
        placeHolder,
        matchOnDescription: true,
        matchOnDetail: true,
    });
    if (!picked) { return; }

    await setFocusUserState(picked.shortname);

    // Refresh status bar and decorations on every visible todo editor.
    for (const visible of vscode.window.visibleTextEditors) {
        if (isTodoFile(visible.document)) {
            updateDimDecorations(visible);
        }
    }
    refreshFocusStatusBar(vscode.window.activeTextEditor);
}

async function setFocusTag(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage('Open a todo file first');
        return;
    }
    const ctx = await getEffectiveEditor(editor);
    if (!isTodoFile(ctx.document)) {
        vscode.window.showWarningMessage('Not a todo file. Add "md-todo: true" to YAML frontmatter.');
        return;
    }
    const parsed = parseDocument(ctx.document);

    type TagPick = vscode.QuickPickItem & { tagname: string | undefined };
    const picks: TagPick[] = [
        { label: '$(circle-slash) Clear focus', description: 'Show all tags', tagname: undefined },
        ...[...parsed.tagDefinitions]
            .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
            .map<TagPick>(t => ({
                label: `$(tag) #${t.name}`,
                detail: t.description,
                tagname: t.name
            }))
    ];

    if (parsed.tagDefinitions.length === 0) {
        vscode.window.showInformationMessage('No tags defined. Add a "## Tags" section first.');
    }

    const current = getFocusTag();
    const placeHolder = current ? `Currently focused on #${current}` : 'Select a tag to focus on (or clear)';
    const picked = await vscode.window.showQuickPick(picks, {
        placeHolder,
        matchOnDescription: true,
        matchOnDetail: true,
    });
    if (!picked) { return; }

    await setFocusTagState(picked.tagname);
    for (const visible of vscode.window.visibleTextEditors) {
        if (isTodoFile(visible.document)) { updateDimDecorations(visible); }
    }
    refreshFocusTagStatusBar(vscode.window.activeTextEditor);
}

/**
 * Toggle `@<shortname>` on the current todo line at the cursor.
 * - If focus is set, use the focused user (no quick pick).
 * - If focus is unset, prompt with a quick pick.
 * - REMOVE if the line already contains `@<shortname>` (whole-word).
 * - Otherwise INSERT at the cursor with surrounding whitespace as needed.
 */
async function assignFocusedUser(editor: vscode.TextEditor): Promise<void> {
    const ctx = await getEffectiveEditor(editor);
    const document = ctx.document;
    const targetEditor = ctx.editor;

    if (!isTodoFile(document)) {
        vscode.window.showWarningMessage('Not a todo file. Add "md-todo: true" to YAML frontmatter.');
        return;
    }

    // Determine target line from the current editor's selection.
    const cursorLine = editor.selection.active.line;
    const cursorChar = editor.selection.active.character;

    const lineText = document.lineAt(cursorLine).text;
    if (!/^\s*-\s*\[[ xX]\]/.test(lineText)) {
        vscode.window.showWarningMessage('Place cursor on a todo line.');
        return;
    }

    // Resolve which user to toggle.
    let shortname = getFocusUser();
    if (!shortname) {
        const parsed = parseDocument(document);
        if (parsed.userDefinitions.length === 0) {
            vscode.window.showInformationMessage('No users defined. Add a "## Users" section first.');
            return;
        }
        type UserPick = vscode.QuickPickItem & { shortname: string };
        const picks: UserPick[] = [...parsed.userDefinitions]
            .sort((a, b) => a.shortname.localeCompare(b.shortname, undefined, { sensitivity: 'base' }))
            .map(u => ({
                label: `$(person) @${u.shortname}`,
                description: u.fullname,
                detail: u.description,
                shortname: u.shortname
            }));
        const picked = await vscode.window.showQuickPick(picks, {
            placeHolder: 'Select user to assign',
            matchOnDescription: true,
            matchOnDetail: true,
        });
        if (!picked) { return; }
        shortname = picked.shortname;
    }

    const mentionToken = `@${shortname}`;

    // Toggle: if the line already contains `@<shortname>` as a whole-word match, remove it.
    const wholeWordRe = new RegExp(`@${shortname}(?![\\w-])`, 'g');
    if (wholeWordRe.test(lineText)) {
        let newText = lineText.replace(wholeWordRe, '');
        // Collapse double-spaces introduced by the removal, but preserve leading indent.
        const leading = newText.match(/^\s*/)?.[0] ?? '';
        newText = leading + newText.slice(leading.length).replace(/ {2,}/g, ' ').replace(/\s+$/, '');
        const lineRange = document.lineAt(cursorLine).range;
        await targetEditor.edit(eb => {
            eb.replace(lineRange, newText);
        });
        return;
    }

    // INSERT at cursor position: pad with spaces if neighbors are non-whitespace.
    // Clamp the insertion column to the actual line length.
    const insertCol = Math.min(cursorChar, lineText.length);
    const prevChar = insertCol > 0 ? lineText.charAt(insertCol - 1) : '';
    const nextChar = insertCol < lineText.length ? lineText.charAt(insertCol) : '';
    let insertText = mentionToken;
    if (prevChar && !/\s/.test(prevChar) && prevChar !== '@') {
        insertText = ' ' + insertText;
    }
    if (nextChar && !/\s/.test(nextChar)) {
        insertText = insertText + ' ';
    }
    await targetEditor.edit(eb => {
        eb.insert(new vscode.Position(cursorLine, insertCol), insertText);
    });
}

// ============================================================================
// Users Tree View (Variant B)
// ============================================================================

type UserNode = {
    kind: 'user';
    user: UserDefinition;
    counts: { active: number; completed: number; archived: number };
    sourceUri: vscode.Uri;
};

type SectionNode = {
    kind: 'section';
    user: UserDefinition | null;  // null for unassigned
    section: 'active' | 'completed' | 'archive';
    items: TodoItem[];
    sourceUri: vscode.Uri;
};

type TodoNode = {
    kind: 'todo';
    item: TodoItem;
    sourceUri: vscode.Uri;
};

type UnassignedNode = {
    kind: 'unassigned';
    counts: { active: number; completed: number; archived: number };
    sourceUri: vscode.Uri;
};

type TreeNode = UserNode | SectionNode | TodoNode | UnassignedNode;

function classifyItemSection(item: TodoItem, parsed: ParsedDocument): 'active' | 'completed' | 'archive' | null {
    for (const [sectionName, sectionInfo] of parsed.sections) {
        if (item.line >= sectionInfo.start && item.line <= sectionInfo.end) {
            if (sectionName === 'active') { return 'active'; }
            if (sectionName === 'completed') { return 'completed'; }
            if (sectionName === 'archive') { return 'archive'; }
            return null;
        }
    }
    return null;
}

class MdTodoUsersTreeProvider implements vscode.TreeDataProvider<TreeNode> {
    private _onDidChangeTreeData = new vscode.EventEmitter<TreeNode | undefined | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private currentUri: vscode.Uri | undefined;
    private refreshTimer: NodeJS.Timeout | undefined;

    constructor(private workspaceState: vscode.Memento) {
        // Restore last todo file from workspace state
        const lastUri = workspaceState.get<string>('mdTodo.users.lastTodoFileUri');
        if (lastUri) {
            try {
                this.currentUri = vscode.Uri.parse(lastUri);
            } catch {
                this.currentUri = undefined;
            }
        }
    }

    setCurrentTodoFile(uri: vscode.Uri | undefined) {
        if (uri && this.currentUri && uri.toString() === this.currentUri.toString()) {
            return;
        }
        this.currentUri = uri;
        if (uri) {
            this.workspaceState.update('mdTodo.users.lastTodoFileUri', uri.toString());
        }
        this._onDidChangeTreeData.fire();
    }

    getCurrentUri(): vscode.Uri | undefined {
        return this.currentUri;
    }

    refresh() {
        this._onDidChangeTreeData.fire();
    }

    refreshDebounced() {
        if (this.refreshTimer) {
            clearTimeout(this.refreshTimer);
        }
        this.refreshTimer = setTimeout(() => {
            this._onDidChangeTreeData.fire();
            this.refreshTimer = undefined;
        }, 200);
    }

    private async getCurrentParsed(): Promise<{ doc: vscode.TextDocument; parsed: ParsedDocument } | null> {
        if (!this.currentUri) { return null; }
        try {
            const doc = await vscode.workspace.openTextDocument(this.currentUri);
            if (!isTodoFile(doc)) { return null; }
            return { doc, parsed: parseDocument(doc) };
        } catch {
            return null;
        }
    }

    getTreeItem(node: TreeNode): vscode.TreeItem {
        if (node.kind === 'user') {
            const total = node.counts.active + node.counts.completed + node.counts.archived;
            const item = new vscode.TreeItem(
                node.user.fullname,
                total > 0
                    ? vscode.TreeItemCollapsibleState.Collapsed
                    : vscode.TreeItemCollapsibleState.None
            );
            item.description = `@${node.user.shortname}  (${node.counts.active} active)`;
            item.tooltip = `${node.user.fullname} — ${node.user.description}\nActive: ${node.counts.active}  Completed: ${node.counts.completed}  Archive: ${node.counts.archived}`;
            item.contextValue = 'user';
            item.iconPath = new vscode.ThemeIcon('person');
            return item;
        }

        if (node.kind === 'unassigned') {
            const total = node.counts.active + node.counts.completed + node.counts.archived;
            const item = new vscode.TreeItem(
                'Unassigned',
                total > 0
                    ? vscode.TreeItemCollapsibleState.Collapsed
                    : vscode.TreeItemCollapsibleState.None
            );
            item.description = `(${node.counts.active} active)`;
            item.tooltip = `Todos with no @mention\nActive: ${node.counts.active}  Completed: ${node.counts.completed}  Archive: ${node.counts.archived}`;
            item.contextValue = 'unassigned';
            item.iconPath = new vscode.ThemeIcon('person-add');
            return item;
        }

        if (node.kind === 'section') {
            const labels = { active: 'Active', completed: 'Completed', archive: 'Archive' };
            const item = new vscode.TreeItem(
                `${labels[node.section]} (${node.items.length})`,
                vscode.TreeItemCollapsibleState.Expanded
            );
            item.contextValue = 'section';
            const iconName = node.section === 'active'
                ? 'list-unordered'
                : node.section === 'completed'
                    ? 'check-all'
                    : 'archive';
            item.iconPath = new vscode.ThemeIcon(iconName);
            return item;
        }

        // Todo leaf
        const todo = node.item;
        const item = new vscode.TreeItem(todo.text || '(untitled)', vscode.TreeItemCollapsibleState.None);
        item.description = todo.isComplete
            ? (todo.completedDate ? `done ${todo.completedDate}` : 'done')
            : (todo.addedDate ? `added ${todo.addedDate}` : '');
        item.tooltip = todo.raw;
        item.contextValue = 'todo';
        item.iconPath = new vscode.ThemeIcon(todo.isComplete ? 'check' : 'circle-outline');

        // Click to jump to source line
        item.command = {
            command: 'vscode.open',
            title: 'Open Todo',
            arguments: [
                node.sourceUri,
                {
                    selection: new vscode.Range(todo.line, 0, todo.line, 0),
                    preview: false
                }
            ]
        };

        return item;
    }

    async getChildren(element?: TreeNode): Promise<TreeNode[]> {
        const ctx = await this.getCurrentParsed();
        if (!ctx) { return []; }
        const { parsed } = ctx;
        const sourceUri = this.currentUri!;

        if (!element) {
            // Roots: one per user + Unassigned
            const userNodes: TreeNode[] = [];
            for (const user of parsed.userDefinitions) {
                const counts = this.countItemsForMention(parsed, user.shortname);
                userNodes.push({ kind: 'user', user, counts, sourceUri });
            }
            userNodes.sort((a, b) =>
                a.kind === 'user' && b.kind === 'user'
                    ? a.user.shortname.localeCompare(b.user.shortname, undefined, { sensitivity: 'base' })
                    : 0
            );

            const unassignedCounts = this.countUnassigned(parsed);
            userNodes.push({ kind: 'unassigned', counts: unassignedCounts, sourceUri });

            return userNodes;
        }

        if (element.kind === 'user') {
            return this.buildSectionNodes(parsed, element.user, sourceUri);
        }

        if (element.kind === 'unassigned') {
            return this.buildSectionNodes(parsed, null, sourceUri);
        }

        if (element.kind === 'section') {
            return element.items.map(item => ({ kind: 'todo' as const, item, sourceUri }));
        }

        return [];
    }

    private buildSectionNodes(parsed: ParsedDocument, user: UserDefinition | null, sourceUri: vscode.Uri): TreeNode[] {
        const buckets: Record<'active' | 'completed' | 'archive', TodoItem[]> = {
            active: [],
            completed: [],
            archive: []
        };

        function visitAll(items: TodoItem[], cb: (it: TodoItem) => void) {
            for (const it of items) {
                cb(it);
                visitAll(it.children, cb);
            }
        }

        visitAll(parsed.items, (it) => {
            const sect = classifyItemSection(it, parsed);
            if (!sect) { return; }
            if (user) {
                if (it.mentions.includes(user.shortname)) {
                    buckets[sect].push(it);
                }
            } else {
                if (it.mentions.length === 0) {
                    buckets[sect].push(it);
                }
            }
        });

        const result: TreeNode[] = [];
        for (const sect of ['active', 'completed', 'archive'] as const) {
            if (buckets[sect].length > 0) {
                result.push({ kind: 'section', user, section: sect, items: buckets[sect], sourceUri });
            }
        }
        return result;
    }

    private countItemsForMention(parsed: ParsedDocument, shortname: string): { active: number; completed: number; archived: number } {
        const counts = { active: 0, completed: 0, archived: 0 };
        function visitAll(items: TodoItem[], cb: (it: TodoItem) => void) {
            for (const it of items) {
                cb(it);
                visitAll(it.children, cb);
            }
        }
        visitAll(parsed.items, (it) => {
            if (!it.mentions.includes(shortname)) { return; }
            const sect = classifyItemSection(it, parsed);
            if (sect === 'active') { counts.active++; }
            else if (sect === 'completed') { counts.completed++; }
            else if (sect === 'archive') { counts.archived++; }
        });
        return counts;
    }

    private countUnassigned(parsed: ParsedDocument): { active: number; completed: number; archived: number } {
        const counts = { active: 0, completed: 0, archived: 0 };
        function visitAll(items: TodoItem[], cb: (it: TodoItem) => void) {
            for (const it of items) {
                cb(it);
                visitAll(it.children, cb);
            }
        }
        visitAll(parsed.items, (it) => {
            if (it.mentions.length !== 0) { return; }
            const sect = classifyItemSection(it, parsed);
            if (sect === 'active') { counts.active++; }
            else if (sect === 'completed') { counts.completed++; }
            else if (sect === 'archive') { counts.archived++; }
        });
        return counts;
    }
}

// ============================================================================
// User Tree Commands
// ============================================================================

async function focusOnUserFromTree(node?: TreeNode) {
    if (!node || node.kind !== 'user') {
        vscode.window.showWarningMessage('Right-click a user in the MD Todo Users view.');
        return;
    }
    await setFocusUserState(node.user.shortname);
    refreshFocusStatusBar(vscode.window.activeTextEditor);
    for (const visible of vscode.window.visibleTextEditors) {
        updateDimDecorations(visible);
    }
}

async function clearUserFocusFromTree() {
    await setFocusUserState(undefined);
    refreshFocusStatusBar(vscode.window.activeTextEditor);
    for (const visible of vscode.window.visibleTextEditors) {
        if (isTodoFile(visible.document)) { updateDimDecorations(visible); }
    }
}

async function reassignUserFromTree(treeProvider: MdTodoUsersTreeProvider, node?: TreeNode) {
    if (!node || node.kind !== 'todo') { return; }

    const uri = treeProvider.getCurrentUri();
    if (!uri) { return; }

    const doc = await vscode.workspace.openTextDocument(uri);
    const parsed = parseDocument(doc);

    if (parsed.userDefinitions.length === 0) {
        vscode.window.showInformationMessage('No users defined. Add a ## Users section first.');
        return;
    }

    const picks = parsed.userDefinitions.map(u => ({
        label: `@${u.shortname}`,
        description: u.fullname,
        detail: u.description,
        user: u
    }));

    const selected = await vscode.window.showQuickPick(picks, {
        placeHolder: `Reassign: ${node.item.text}`,
        matchOnDescription: true,
        matchOnDetail: true,
    });
    if (!selected) { return; }

    // Design choice: if the line already has any @mention, replace the FIRST mention.
    // If none, append the @mention to the end of the line (before any trailing whitespace).
    const editor = await vscode.window.showTextDocument(doc);
    const line = doc.lineAt(node.item.line);
    let newText = line.text;
    const mentionRe = /@[\w-]+/;

    if (mentionRe.test(newText)) {
        newText = newText.replace(mentionRe, `@${selected.user.shortname}`);
    } else {
        newText = newText.replace(/\s*$/, '') + ` @${selected.user.shortname}`;
    }

    await editor.edit(eb => eb.replace(line.range, newText));
    treeProvider.refresh();
}

async function markDoneFromTree(treeProvider: MdTodoUsersTreeProvider, node?: TreeNode) {
    if (!node || node.kind !== 'todo') { return; }
    if (node.item.isComplete) {
        vscode.window.showInformationMessage('Item is already complete');
        return;
    }
    const uri = treeProvider.getCurrentUri();
    if (!uri) { return; }
    const doc = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(doc, { preview: false });
    await markDone(editor, undefined, node.item.line);
    treeProvider.refresh();
}

// ============================================================================
// Tags Tree View (Variant BC3)
// ============================================================================

type TagRootNode = {
    kind: 'tag-root';
    tag: TagDefinition;
    counts: { active: number; completed: number; archived: number };
    sourceUri: vscode.Uri;
};

type TagSectionNode = {
    kind: 'tag-section';
    tag: TagDefinition | null;  // null for untagged
    section: 'active' | 'completed' | 'archive';
    items: TodoItem[];
    sourceUri: vscode.Uri;
};

type TagTodoNode = {
    kind: 'tag-todo';
    item: TodoItem;
    sourceUri: vscode.Uri;
};

type UntaggedNode = {
    kind: 'untagged';
    counts: { active: number; completed: number; archived: number };
    sourceUri: vscode.Uri;
};

type TagsTreeNode = TagRootNode | TagSectionNode | TagTodoNode | UntaggedNode;

class MdTodoTagsTreeProvider implements vscode.TreeDataProvider<TagsTreeNode> {
    private _onDidChangeTreeData = new vscode.EventEmitter<TagsTreeNode | undefined | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private currentUri: vscode.Uri | undefined;
    private refreshTimer: NodeJS.Timeout | undefined;

    constructor(private workspaceState: vscode.Memento) {
        const lastUri = workspaceState.get<string>('mdTodo.tags.lastTodoFileUri');
        if (lastUri) {
            try {
                this.currentUri = vscode.Uri.parse(lastUri);
            } catch {
                this.currentUri = undefined;
            }
        }
    }

    setCurrentTodoFile(uri: vscode.Uri | undefined) {
        if (uri && this.currentUri && uri.toString() === this.currentUri.toString()) {
            return;
        }
        this.currentUri = uri;
        if (uri) {
            this.workspaceState.update('mdTodo.tags.lastTodoFileUri', uri.toString());
        }
        this._onDidChangeTreeData.fire();
    }

    getCurrentUri(): vscode.Uri | undefined {
        return this.currentUri;
    }

    refresh() {
        this._onDidChangeTreeData.fire();
    }

    refreshDebounced() {
        if (this.refreshTimer) {
            clearTimeout(this.refreshTimer);
        }
        this.refreshTimer = setTimeout(() => {
            this._onDidChangeTreeData.fire();
            this.refreshTimer = undefined;
        }, 200);
    }

    private async getCurrentParsed(): Promise<{ doc: vscode.TextDocument; parsed: ParsedDocument } | null> {
        if (!this.currentUri) { return null; }
        try {
            const doc = await vscode.workspace.openTextDocument(this.currentUri);
            if (!isTodoFile(doc)) { return null; }
            return { doc, parsed: parseDocument(doc) };
        } catch {
            return null;
        }
    }

    getTreeItem(node: TagsTreeNode): vscode.TreeItem {
        if (node.kind === 'tag-root') {
            const total = node.counts.active + node.counts.completed + node.counts.archived;
            const item = new vscode.TreeItem(
                `#${node.tag.name}`,
                total > 0
                    ? vscode.TreeItemCollapsibleState.Collapsed
                    : vscode.TreeItemCollapsibleState.None
            );
            item.description = `(${node.counts.active} active)`;
            item.tooltip = `#${node.tag.name} — ${node.tag.description}\nActive: ${node.counts.active}  Completed: ${node.counts.completed}  Archive: ${node.counts.archived}`;
            item.contextValue = 'tag-root';
            item.iconPath = new vscode.ThemeIcon('tag');
            return item;
        }

        if (node.kind === 'untagged') {
            const total = node.counts.active + node.counts.completed + node.counts.archived;
            const item = new vscode.TreeItem(
                'Untagged',
                total > 0
                    ? vscode.TreeItemCollapsibleState.Collapsed
                    : vscode.TreeItemCollapsibleState.None
            );
            item.description = `(${node.counts.active} active)`;
            item.tooltip = `Todos with no #tag\nActive: ${node.counts.active}  Completed: ${node.counts.completed}  Archive: ${node.counts.archived}`;
            item.contextValue = 'untagged';
            item.iconPath = new vscode.ThemeIcon('circle-slash');
            return item;
        }

        if (node.kind === 'tag-section') {
            const labels = { active: 'Active', completed: 'Completed', archive: 'Archive' };
            const item = new vscode.TreeItem(
                `${labels[node.section]} (${node.items.length})`,
                vscode.TreeItemCollapsibleState.Expanded
            );
            item.contextValue = 'tag-section';
            const iconName = node.section === 'active'
                ? 'list-unordered'
                : node.section === 'completed'
                    ? 'check-all'
                    : 'archive';
            item.iconPath = new vscode.ThemeIcon(iconName);
            return item;
        }

        // Tag-todo leaf
        const todo = node.item;
        const item = new vscode.TreeItem(todo.text || '(untitled)', vscode.TreeItemCollapsibleState.None);
        item.description = todo.isComplete
            ? (todo.completedDate ? `done ${todo.completedDate}` : 'done')
            : (todo.addedDate ? `added ${todo.addedDate}` : '');
        item.tooltip = todo.raw;
        item.contextValue = 'tag-todo';
        item.iconPath = new vscode.ThemeIcon(todo.isComplete ? 'check' : 'circle-outline');

        // Click to jump to source line
        item.command = {
            command: 'vscode.open',
            title: 'Open Todo',
            arguments: [
                node.sourceUri,
                {
                    selection: new vscode.Range(todo.line, 0, todo.line, 0),
                    preview: false
                }
            ]
        };

        return item;
    }

    async getChildren(element?: TagsTreeNode): Promise<TagsTreeNode[]> {
        const ctx = await this.getCurrentParsed();
        if (!ctx) { return []; }
        const { parsed } = ctx;
        const sourceUri = this.currentUri!;

        if (!element) {
            // Roots: one per tag definition + Untagged
            const roots: TagsTreeNode[] = [];
            for (const tag of parsed.tagDefinitions) {
                const counts = this.countItemsForTag(parsed, tag.name);
                roots.push({ kind: 'tag-root', tag, counts, sourceUri });
            }
            roots.sort((a, b) =>
                a.kind === 'tag-root' && b.kind === 'tag-root'
                    ? a.tag.name.localeCompare(b.tag.name, undefined, { sensitivity: 'base' })
                    : 0
            );
            const untaggedCounts = this.countUntagged(parsed);
            roots.push({ kind: 'untagged', counts: untaggedCounts, sourceUri });
            return roots;
        }

        if (element.kind === 'tag-root') {
            return this.buildSectionNodes(parsed, element.tag, sourceUri);
        }

        if (element.kind === 'untagged') {
            return this.buildSectionNodes(parsed, null, sourceUri);
        }

        if (element.kind === 'tag-section') {
            return element.items.map(item => ({ kind: 'tag-todo' as const, item, sourceUri }));
        }

        return [];
    }

    private buildSectionNodes(parsed: ParsedDocument, tag: TagDefinition | null, sourceUri: vscode.Uri): TagsTreeNode[] {
        const buckets: Record<'active' | 'completed' | 'archive', TodoItem[]> = {
            active: [],
            completed: [],
            archive: []
        };

        function visitAll(items: TodoItem[], cb: (it: TodoItem) => void) {
            for (const it of items) {
                cb(it);
                visitAll(it.children, cb);
            }
        }

        visitAll(parsed.items, (it) => {
            const sect = classifyItemSection(it, parsed);
            if (!sect) { return; }
            if (tag) {
                if (it.tags.includes(tag.name)) {
                    buckets[sect].push(it);
                }
            } else {
                if (it.tags.length === 0) {
                    buckets[sect].push(it);
                }
            }
        });

        const result: TagsTreeNode[] = [];
        for (const sect of ['active', 'completed', 'archive'] as const) {
            if (buckets[sect].length > 0) {
                result.push({ kind: 'tag-section', tag, section: sect, items: buckets[sect], sourceUri });
            }
        }
        return result;
    }

    private countItemsForTag(parsed: ParsedDocument, tagName: string): { active: number; completed: number; archived: number } {
        const counts = { active: 0, completed: 0, archived: 0 };
        function visitAll(items: TodoItem[], cb: (it: TodoItem) => void) {
            for (const it of items) {
                cb(it);
                visitAll(it.children, cb);
            }
        }
        visitAll(parsed.items, (it) => {
            if (!it.tags.includes(tagName)) { return; }
            const sect = classifyItemSection(it, parsed);
            if (sect === 'active') { counts.active++; }
            else if (sect === 'completed') { counts.completed++; }
            else if (sect === 'archive') { counts.archived++; }
        });
        return counts;
    }

    private countUntagged(parsed: ParsedDocument): { active: number; completed: number; archived: number } {
        const counts = { active: 0, completed: 0, archived: 0 };
        function visitAll(items: TodoItem[], cb: (it: TodoItem) => void) {
            for (const it of items) {
                cb(it);
                visitAll(it.children, cb);
            }
        }
        visitAll(parsed.items, (it) => {
            if (it.tags.length !== 0) { return; }
            const sect = classifyItemSection(it, parsed);
            if (sect === 'active') { counts.active++; }
            else if (sect === 'completed') { counts.completed++; }
            else if (sect === 'archive') { counts.archived++; }
        });
        return counts;
    }
}

// ============================================================================
// Tag Tree Commands
// ============================================================================

async function focusOnTagFromTree(node?: TagsTreeNode) {
    if (!node || node.kind !== 'tag-root') {
        vscode.window.showWarningMessage('Right-click a tag in the MD Todo Tags view.');
        return;
    }
    await setFocusTagState(node.tag.name);
    refreshFocusTagStatusBar(vscode.window.activeTextEditor);
    for (const visible of vscode.window.visibleTextEditors) {
        updateDimDecorations(visible);
    }
}

async function clearTagFocusFromTree() {
    await setFocusTagState(undefined);
    refreshFocusTagStatusBar(vscode.window.activeTextEditor);
    for (const visible of vscode.window.visibleTextEditors) {
        if (isTodoFile(visible.document)) { updateDimDecorations(visible); }
    }
}

async function markDoneFromTagsTree(treeProvider: MdTodoTagsTreeProvider, node?: TagsTreeNode) {
    if (!node || node.kind !== 'tag-todo') { return; }
    if (node.item.isComplete) {
        vscode.window.showInformationMessage('Item is already complete');
        return;
    }
    const doc = await vscode.workspace.openTextDocument(node.sourceUri);
    const editor = await vscode.window.showTextDocument(doc, { preview: false });
    await markDone(editor, undefined, node.item.line);
    treeProvider.refresh();
}

async function editTagsFromTree(node?: TagsTreeNode) {
    if (!node || node.kind !== 'tag-todo') { return; }
    const doc = await vscode.workspace.openTextDocument(node.sourceUri);
    const editor = await vscode.window.showTextDocument(doc, { preview: false });
    // Place cursor on the target line so addTags' findItemAtCursor picks it up.
    const pos = new vscode.Position(node.item.line, 0);
    editor.selection = new vscode.Selection(pos, pos);
    editor.revealRange(new vscode.Range(pos, pos));
    await vscode.commands.executeCommand('mdTodo.addTags');
}

// ============================================================================
// Shared input prompt with @user / #tag autocomplete
// ============================================================================

type SuggestionItem = vscode.QuickPickItem & { insertText: string };

/**
 * Filter `defs` by case-insensitive substring of `partial` over the text
 * returned by `searchable`, sort the matches alphabetically by `sortKey`
 * (case-insensitive via localeCompare with sensitivity: 'base'), then map to
 * SuggestionItems via `toItem`. The sort here is belt-and-braces: parseDocument
 * already pre-sorts userDefinitions and tagDefinitions at the source, but
 * keeping the comparator visible at the consumer site documents the contract
 * and survives future refactors of parseDocument.
 */
function sortedSuggestions<T>(
    defs: readonly T[],
    partial: string,
    searchable: (d: T) => string,
    sortKey: (d: T) => string,
    toItem: (d: T) => SuggestionItem,
): SuggestionItem[] {
    return defs
        .filter(d => searchable(d).toLowerCase().includes(partial))
        .slice()
        .sort((a, b) => sortKey(a).localeCompare(sortKey(b), undefined, { sensitivity: 'base' }))
        .map(toItem);
}

/**
 * Prompt the user for free-form todo / note text with inline @user / #tag
 * suggestions. As the user types an `@xxx` or `#xxx` token at the end of the
 * value, matching users / tags from the document populate the picker. Selecting
 * one inserts it into the value and keeps the picker open. Pressing Enter with
 * no item highlighted submits the value as the result.
 */
function promptForTodoText(
    document: vscode.TextDocument,
    options: { prompt: string; placeHolder: string }
): Promise<string | undefined> {
    const parsed = parseDocument(document);

    return new Promise<string | undefined>(resolve => {
        const qp = vscode.window.createQuickPick<SuggestionItem>();
        qp.title = options.prompt;
        qp.placeholder = options.placeHolder;
        // Intentionally NOT enabling matchOnDescription / matchOnDetail: we
        // run our own substring filter on shortname+fullname+description below.
        // Letting VS Code additionally fuzzy-match the typed value against
        // those fields makes items whose description/detail happens to contain
        // '@' or '#' score higher than items without — re-ordering the list
        // we hand to qp.items and producing the "random-looking" order users
        // see when '@' or '#' is the very first character of input. With both
        // flags off, scoring is uniform across items for a single trigger char
        // and VS Code preserves the alphabetical insertion order we set.
        qp.matchOnDescription = false;
        qp.matchOnDetail = false;
        qp.ignoreFocusOut = true;

        let resolved = false;
        const finish = (result: string | undefined) => {
            if (resolved) { return; }
            resolved = true;
            resolve(result);
            qp.hide();
        };

        const refreshSuggestions = (value: string) => {
            const tokenMatch = value.match(/([@#])([\w-]*)$/);
            if (!tokenMatch) {
                qp.items = [];
                qp.activeItems = [];
                return;
            }
            const trigger = tokenMatch[1];
            const partial = tokenMatch[2].toLowerCase();
            let items: SuggestionItem[] = [];
            if (trigger === '@') {
                items = sortedSuggestions(parsed.userDefinitions, partial,
                    u => `${u.shortname} ${u.fullname} ${u.description}`,
                    u => u.shortname,
                    u => ({
                        label: `@${u.shortname}`,
                        description: u.fullname,
                        detail: u.description,
                        insertText: `@${u.shortname}`,
                        alwaysShow: true,
                    }));
            } else {
                items = sortedSuggestions(parsed.tagDefinitions, partial,
                    t => `${t.name} ${t.description}`,
                    t => t.name,
                    t => ({
                        label: `#${t.name}`,
                        description: t.description,
                        detail: '',
                        insertText: `#${t.name}`,
                        alwaysShow: true,
                    }));
            }
            qp.items = items;
            qp.activeItems = [];
        };

        qp.onDidChangeValue(refreshSuggestions);

        qp.onDidAccept(() => {
            const active = qp.activeItems[0];
            if (active) {
                // Replace the trailing @xxx / #xxx token with the picked text + trailing space.
                const newValue = qp.value.replace(/([@#])([\w-]*)$/, `${active.insertText} `);
                qp.value = newValue;
                qp.items = [];
                qp.activeItems = [];
                return;
            }
            finish(qp.value || undefined);
        });

        qp.onDidHide(() => {
            finish(undefined);
            qp.dispose();
        });

        qp.show();
    });
}

// ============================================================================
// Hover & Completion providers for @mentions
// ============================================================================

const userHoverProvider: vscode.HoverProvider = {
    provideHover(document, position) {
        if (!isTodoFile(document)) { return undefined; }
        // Detect @<word> covering the cursor position.
        const range = document.getWordRangeAtPosition(position, /@[\w-]+/);
        if (!range) { return undefined; }
        const token = document.getText(range);
        const shortname = token.slice(1);
        const parsed = parseDocument(document);
        const user = parsed.userDefinitions.find(u => u.shortname === shortname);
        if (!user) { return undefined; }
        const md = new vscode.MarkdownString();
        const fullname = user.fullname || user.shortname;
        md.appendMarkdown(`**${fullname}** (\`@${user.shortname}\`)\n\n${user.description}`);
        return new vscode.Hover(md, range);
    }
};

const userCompletionProvider: vscode.CompletionItemProvider = {
    async provideCompletionItems(document, position) {
        const sourceDoc = isTodoFile(document) ? document : await getLastTodoSourceDoc();
        if (!sourceDoc) { return undefined; }
        const parsed = parseDocument(sourceDoc);
        if (parsed.userDefinitions.length === 0) { return undefined; }

        // Decide whether to append a trailing space based on the next character.
        const lineText = document.lineAt(position.line).text;
        const nextChar = position.character < lineText.length ? lineText.charAt(position.character) : '';
        const trailingSpace = nextChar && !/\s/.test(nextChar) ? ' ' : '';

        return parsed.userDefinitions.map(u => {
            const item = new vscode.CompletionItem(`@${u.shortname}`, vscode.CompletionItemKind.User);
            item.detail = u.description ? `${u.fullname} — ${u.description}` : u.fullname;
            item.documentation = new vscode.MarkdownString(`**${u.fullname}** (\`@${u.shortname}\`)\n\n${u.description}`);
            // Replace just the inserted '@' with the full mention so we don't double-up.
            item.insertText = `@${u.shortname}${trailingSpace}`;
            const replaceStart = new vscode.Position(position.line, Math.max(0, position.character - 1));
            item.range = new vscode.Range(replaceStart, position);
            item.filterText = `@${u.shortname} ${u.fullname} ${u.description}`;
            item.sortText = u.shortname;
            return item;
        });
    }
};

const tagCompletionProvider: vscode.CompletionItemProvider = {
    async provideCompletionItems(document, position) {
        const sourceDoc = isTodoFile(document) ? document : await getLastTodoSourceDoc();
        if (!sourceDoc) { return undefined; }
        const parsed = parseDocument(sourceDoc);
        if (parsed.tagDefinitions.length === 0) { return undefined; }
        const lineText = document.lineAt(position.line).text;
        const nextChar = position.character < lineText.length ? lineText.charAt(position.character) : '';
        const trailingSpace = nextChar && !/\s/.test(nextChar) ? ' ' : '';
        return parsed.tagDefinitions.map(t => {
            const item = new vscode.CompletionItem(`#${t.name}`, vscode.CompletionItemKind.Keyword);
            item.detail = t.description;
            item.documentation = new vscode.MarkdownString(`**\`#${t.name}\`**\n\n${t.description}`);
            item.insertText = `#${t.name}${trailingSpace}`;
            const replaceStart = new vscode.Position(position.line, Math.max(0, position.character - 1));
            item.range = new vscode.Range(replaceStart, position);
            item.filterText = `#${t.name} ${t.description}`;
            item.sortText = t.name;
            return item;
        });
    }
};

// ============================================================================
// Extension Activation
// ============================================================================

export function activate(context: vscode.ExtensionContext) {
    console.log('MD Todo is now active');
    extensionContext = context;

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

    // Status bar item for current focus user (Variant C).
    focusStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    focusStatusBarItem.command = 'mdTodo.setFocusUser';
    context.subscriptions.push(focusStatusBarItem);

    // Tag-focus status bar (priority 99 so user-focus at 100 sits to its right).
    tagFocusStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
    tagFocusStatusBarItem.command = 'mdTodo.setFocusTag';
    context.subscriptions.push(tagFocusStatusBarItem);

    // Activity-focus status bar (priority 98, sits to the right of tag-focus).
    activityFocusStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 98);
    activityFocusStatusBarItem.command = 'mdTodo.activityFocusMenu';
    context.subscriptions.push(activityFocusStatusBarItem);

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
