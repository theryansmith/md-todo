import {
    TodoItem,
    TagDefinition,
    UserDefinition,
    ProjectDefinition,
    ParsedDocument,
} from '../model';
import { TextDocumentLike } from '../text-document';
import { isNoteLine } from '../query/items';
import { PROJECT_TOKEN_RE, PROJECT_TOKEN_RE_G } from '../tokens';

/**
 * Parse a todo document into items, sections, and definitions. PURE — no
 * caching, no host types; the (uri, version) memo over this lives in
 * vscode/document-cache.ts because URIs and versions are host concepts.
 */
export function parseDocument(document: TextDocumentLike): ParsedDocument {
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
