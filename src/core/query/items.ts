import { TodoItem, TagDefinition, TagValidationResult, ParsedDocument } from '../model';
import { TextDocumentLike } from '../text-document';

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

export function getItemWithDescendantsEndLine(document: TextDocumentLike, item: TodoItem): number {
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

export function getItemEndLine(document: TextDocumentLike, startLine: number): number {
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
