import * as vscode from 'vscode';
import {
    TodoItem,
    TagDefinition,
    UserDefinition,
    ProjectDefinition,
    ParsedDocument,
    TagValidationResult,
    ActivityFocus,
} from './model';
import { parseDate, daysBetween, isDateInRange } from './dates';
import { PROJECT_TOKEN_RE, PROJECT_TOKEN_RE_G } from './tokens';

export function isTodoFile(document: vscode.TextDocument): boolean {
    if (document.languageId !== 'markdown') {
        return false;
    }
    if (document.lineCount < 3) {
        return false;
    }

    const firstLine = document.lineAt(0).text;
    if (firstLine !== '---') {
        return false;
    }

    for (let i = 1; i < Math.min(document.lineCount, 20); i++) {
        const line = document.lineAt(i).text;
        if (line === '---') {
            for (let j = 1; j < i; j++) {
                if (/^md-todo:\s*true/i.exec(document.lineAt(j).text)) {
                    return true;
                }
            }
            return false;
        }
    }
    return false;
}

export function isNoteLine(text: string): boolean {
    const hasCheckbox = /^\s+-\s*\[[ xX]\]/.test(text);
    const isIndentedBullet = /^\s+-\s+.+/.test(text);
    return isIndentedBullet && !hasCheckbox;
}

export function isNestedTodoLine(text: string): boolean {
    return /^\s+-\s*\[[ xX]\]\s*.+$/.test(text);
}

export function findItemForSourceLine(sourceLine: number, parsed: ParsedDocument): TodoItem | null {
    function searchItems(items: TodoItem[]): TodoItem | null {
        for (const item of items) {
            if (item.line === sourceLine) {
                return item;
            }
            if (sourceLine > item.line && sourceLine <= item.line + item.notes.length) {
                return item;
            }
            const foundInChildren = searchItems(item.children);
            if (foundInChildren) {
                return foundInChildren;
            }
        }
        return null;
    }

    return searchItems(parsed.items);
}

export function validateTags(tags: string[], tagDefinitions: TagDefinition[]): TagValidationResult {
    const definedNames = new Set(tagDefinitions.map((t) => t.name));
    return {
        validTags: tags.filter((t) => definedNames.has(t)),
        undefinedTags: tags.filter((t) => !definedNames.has(t)),
    };
}

export function isNestedItem(item: TodoItem): boolean {
    return item.parent !== undefined;
}

export function getItemWithDescendantsEndLine(
    document: vscode.TextDocument,
    item: TodoItem
): number {
    let endLine = item.line;
    for (let i = item.line + 1; i < document.lineCount; i++) {
        const lineText = document.lineAt(i).text;
        const lineIndent = /^(\s*)/.exec(lineText)?.[1].length ?? 0;
        if (lineText.trim() && lineIndent <= item.indent) {
            break;
        }
        if (lineText.startsWith('#')) {
            break;
        }
        endLine = i;
    }
    return endLine;
}

export function findItemByLine(items: TodoItem[], lineNum: number): TodoItem | null {
    for (const item of items) {
        if (item.line === lineNum) {
            return item;
        }
        const found = findItemByLine(item.children, lineNum);
        if (found) {
            return found;
        }
    }
    return null;
}

// Type lives here (not in core/model.ts) because it references vscode; both it
// and getEffectiveEditor move to the vscode layer in the Phase 2 parser split
// and die entirely in Phase 3a.
export interface EffectiveEditorContext {
    editor: vscode.TextEditor;
    document: vscode.TextDocument;
}

export function getEffectiveEditor(
    currentEditor: vscode.TextEditor
): Promise<EffectiveEditorContext> {
    return Promise.resolve({ editor: currentEditor, document: currentEditor.document });
}

// Memoizes the most recent parse per document URI. Keyed by URI string with
// the document version stored alongside so a lookup is a cache hit only when
// (uri, version) matches exactly. One entry per URI is enough — older versions
// of the same document are never useful again.
const parseCache = new Map<string, { version: number; parsed: ParsedDocument }>();

export function clearParseCache(uri?: vscode.Uri): void {
    if (uri) {
        parseCache.delete(uri.toString());
    } else {
        parseCache.clear();
    }
}

export function parseDocument(document: vscode.TextDocument): ParsedDocument {
    const key = document.uri.toString();
    const cached = parseCache.get(key);
    if (cached?.version === document.version) {
        return cached.parsed;
    }
    const parsed = parseDocumentUncached(document);
    parseCache.set(key, { version: document.version, parsed });
    return parsed;
}

function parseDocumentUncached(document: vscode.TextDocument): ParsedDocument {
    const items: TodoItem[] = [];
    const sections = new Map<string, { start: number; end: number }>();

    let currentSection = '';
    let sectionStart = 0;

    const parentStack: { item: TodoItem; indent: number }[] = [];

    for (let i = 0; i < document.lineCount; i++) {
        const line = document.lineAt(i);
        const text = line.text;

        const sectionMatch = /^##\s+(.+)$/.exec(text);
        if (sectionMatch) {
            if (currentSection) {
                sections.set(currentSection.toLowerCase(), { start: sectionStart, end: i - 1 });
            }
            currentSection = sectionMatch[1];
            sectionStart = i;
            parentStack.length = 0;
            continue;
        }

        const todoMatch = /^(\s*)-\s*\[([ xX])\]\s*(.+)$/.exec(text);
        if (todoMatch) {
            const indent = todoMatch[1].length;
            const isComplete = todoMatch[2].toLowerCase() === 'x';
            const content = todoMatch[3];

            const addedMatch = /`\+(\d{4}-\d{2}-\d{2})`/.exec(content);
            const completedMatch = /`✓(\d{4}-\d{2}-\d{2})`/.exec(content);

            const tagMatches = [...content.matchAll(/#([\w-]+)/g)];
            const tags = tagMatches.map((m) => m[1]);

            const mentionMatches = [...content.matchAll(/@([\w-]+)/g)];
            const mentions = mentionMatches.map((m) => m[1]);

            const projectMatch = content.match(PROJECT_TOKEN_RE);
            const project = projectMatch ? projectMatch[1] : undefined;

            const newItem: TodoItem = {
                line: i,
                text: content
                    .replace(/`[+✓]\d{4}-\d{2}-\d{2}`/g, '')
                    .replace(PROJECT_TOKEN_RE_G, '')
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
                project,
                children: [],
                parent: undefined,
            };

            while (parentStack.length > 0 && parentStack[parentStack.length - 1].indent >= indent) {
                parentStack.pop();
            }

            if (parentStack.length > 0) {
                const parentEntry = parentStack[parentStack.length - 1];
                newItem.parent = parentEntry.item;
                parentEntry.item.children.push(newItem);
            } else {
                items.push(newItem);
            }

            parentStack.push({ item: newItem, indent });
            continue;
        }

        if (isNoteLine(text) && parentStack.length > 0) {
            const noteIndent = /^(\s*)/.exec(text)?.[1].length ?? 0;
            for (let j = parentStack.length - 1; j >= 0; j--) {
                if (parentStack[j].indent < noteIndent) {
                    parentStack[j].item.notes.push(text.trim());
                    break;
                }
            }
            continue;
        }

        if (!text.trim() || text.startsWith('#')) {
            parentStack.length = 0;
        }
    }

    if (currentSection) {
        sections.set(currentSection.toLowerCase(), {
            start: sectionStart,
            end: document.lineCount - 1,
        });
    }

    const tagDefinitions: TagDefinition[] = [];
    const tagsSection = sections.get('tags');
    if (tagsSection) {
        for (let i = tagsSection.start + 1; i <= tagsSection.end; i++) {
            const line = document.lineAt(i).text;
            const match = /^\*\*([\w-]+)\*\*:\s*(.+)$/.exec(line);
            if (match) {
                tagDefinitions.push({ name: match[1], description: match[2], line: i });
            }
        }
    }

    // Format: **shortname** (Full Name): description
    // Group 1: shortname; Group 2: fullname (optional); Group 3: description.
    const userDefinitions: UserDefinition[] = [];
    const usersSection = sections.get('users');
    if (usersSection) {
        for (let i = usersSection.start + 1; i <= usersSection.end; i++) {
            const line = document.lineAt(i).text;
            const match = /^\*\*([\w-]+)\*\*\s*(?:\(([^)]+)\))?\s*:\s*(.+)$/.exec(line);
            if (match) {
                // Capture group 2 is optional; without noUncheckedIndexedAccess TS types
                // the indexed access as `string`, so widen explicitly to keep the fallback.
                const fullname = match[2] as string | undefined;
                userDefinitions.push({
                    shortname: match[1],
                    fullname: fullname ?? '',
                    description: match[3],
                    line: i,
                });
            }
        }
    }

    const projectDefinitions: ProjectDefinition[] = [];
    const projectsSection = sections.get('projects');
    if (projectsSection) {
        for (let i = projectsSection.start + 1; i <= projectsSection.end; i++) {
            const line = document.lineAt(i).text;
            const match = /^\*\*([\w-]+)\*\*:\s*(.+)$/.exec(line);
            if (match) {
                projectDefinitions.push({ name: match[1], description: match[2], line: i });
            }
        }
    }

    // Sort definitions once at the source so every consumer (QuickPick
    // suggestion lists in promptForTodoText, completion providers, tree views,
    // status-bar pickers, etc.) sees the same canonical alphabetical order.
    tagDefinitions.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    userDefinitions.sort((a, b) =>
        a.shortname.localeCompare(b.shortname, undefined, { sensitivity: 'base' })
    );
    projectDefinitions.sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    );

    return { items, sections, tagDefinitions, userDefinitions, projectDefinitions };
}

/**
 * Resolve the project an item belongs to: its own `[name]` token if present,
 * otherwise the nearest ancestor's. Children inherit the enclosing project
 * unless they carry their own token.
 */
export function getEffectiveProject(item: TodoItem): string | undefined {
    let cur: TodoItem | undefined = item;
    while (cur) {
        if (cur.project) {
            return cur.project;
        }
        cur = cur.parent;
    }
    return undefined;
}

export function isDefinedProject(name: string, projectDefinitions: ProjectDefinition[]): boolean {
    return projectDefinitions.some((p) => p.name === name);
}

export function findItemAtCursor(
    editor: vscode.TextEditor
): { item: TodoItem; lineNum: number } | null {
    const document = editor.document;
    const cursorLine = editor.selection.active.line;
    const parsed = parseDocument(document);

    for (let i = cursorLine; i >= 0; i--) {
        const line = document.lineAt(i);
        const match = /^(\s*)-\s*\[([ xX])\]\s*(.+)$/.exec(line.text);
        if (match) {
            const item = findItemByLine(parsed.items, i);
            if (item) {
                return { item, lineNum: i };
            }
        }
        if (line.text.startsWith('#') || (line.text.trim() === '' && i < cursorLine - 1)) {
            break;
        }
    }
    return null;
}

export function getItemEndLine(document: vscode.TextDocument, startLine: number): number {
    const startText = document.lineAt(startLine).text;
    const startIndent = /^(\s*)/.exec(startText)?.[1].length ?? 0;

    for (let i = startLine + 1; i < document.lineCount; i++) {
        const line = document.lineAt(i).text;
        if (!line.trim()) {
            continue;
        }
        if (line.startsWith('#')) {
            return i - 1;
        }

        const lineIndent = /^(\s*)/.exec(line)?.[1].length ?? 0;
        if (lineIndent <= startIndent && /^\s*-\s*\[[ xX]\]/.test(line)) {
            return i - 1;
        }
        if (isNoteLine(line) || isNestedTodoLine(line)) {
            continue;
        }
        return i - 1;
    }
    return document.lineCount - 1;
}

export function classifyItemSection(
    item: TodoItem,
    parsed: ParsedDocument
): 'active' | 'completed' | 'archive' | null {
    for (const [sectionName, sectionInfo] of parsed.sections) {
        if (item.line >= sectionInfo.start && item.line <= sectionInfo.end) {
            if (sectionName === 'active') {
                return 'active';
            }
            if (sectionName === 'completed') {
                return 'completed';
            }
            if (sectionName === 'archive') {
                return 'archive';
            }
            return null;
        }
    }
    return null;
}

export function itemMatchesActivity(item: TodoItem, activity: ActivityFocus, today: Date): boolean {
    if (activity.kind === 'completed') {
        if (!item.completedDate) {
            return false;
        }
        const d = parseDate(item.completedDate);
        if (!d) {
            return false;
        }
        return isDateInRange(d, activity.startDate!, activity.endDate!);
    }
    if (activity.kind === 'added') {
        if (!item.addedDate) {
            return false;
        }
        const d = parseDate(item.addedDate);
        if (!d) {
            return false;
        }
        return isDateInRange(d, activity.startDate!, activity.endDate!);
    }
    if (item.isComplete || !item.addedDate) {
        return false;
    }
    const d = parseDate(item.addedDate);
    if (!d) {
        return false;
    }
    return daysBetween(today, d) >= (activity.staleDays ?? 0);
}
