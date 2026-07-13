import * as vscode from 'vscode';
import { isTodoFile, parseDocument } from './parser';
import { formatProjectToken } from './tokens';
import { getLastTodoSourceDoc } from './state';

export const userHoverProvider: vscode.HoverProvider = {
    provideHover(document, position) {
        if (!isTodoFile(document)) { return undefined; }
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

export const userCompletionProvider: vscode.CompletionItemProvider = {
    async provideCompletionItems(document, position) {
        const sourceDoc = isTodoFile(document) ? document : await getLastTodoSourceDoc();
        if (!sourceDoc) { return undefined; }
        const parsed = parseDocument(sourceDoc);
        if (parsed.userDefinitions.length === 0) { return undefined; }

        const lineText = document.lineAt(position.line).text;
        const nextChar = position.character < lineText.length ? lineText.charAt(position.character) : '';
        const trailingSpace = nextChar && !/\s/.test(nextChar) ? ' ' : '';

        return parsed.userDefinitions.map(u => {
            const item = new vscode.CompletionItem(`@${u.shortname}`, vscode.CompletionItemKind.User);
            item.detail = u.description ? `${u.fullname} — ${u.description}` : u.fullname;
            item.documentation = new vscode.MarkdownString(`**${u.fullname}** (\`@${u.shortname}\`)\n\n${u.description}`);
            item.insertText = `@${u.shortname}${trailingSpace}`;
            const replaceStart = new vscode.Position(position.line, Math.max(0, position.character - 1));
            item.range = new vscode.Range(replaceStart, position);
            item.filterText = `@${u.shortname} ${u.fullname} ${u.description}`;
            item.sortText = u.shortname;
            return item;
        });
    }
};

export const tagCompletionProvider: vscode.CompletionItemProvider = {
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

export const projectCompletionProvider: vscode.CompletionItemProvider = {
    async provideCompletionItems(document, position) {
        const sourceDoc = isTodoFile(document) ? document : await getLastTodoSourceDoc();
        if (!sourceDoc) { return undefined; }
        const parsed = parseDocument(sourceDoc);
        if (parsed.projectDefinitions.length === 0) { return undefined; }
        const lineText = document.lineAt(position.line).text;
        const nextChar = position.character < lineText.length ? lineText.charAt(position.character) : '';
        // The editor may have auto-closed the typed `[` with a `]` — extend
        // the replace range one char right to swallow it, so the inserted
        // token doesn't end up followed by a stray bracket.
        const swallowAutoClose = nextChar === ']' ? 1 : 0;
        // Trailing-space handling same as tags, but measured after any
        // swallowed auto-close bracket.
        const afterIdx = position.character + swallowAutoClose;
        const afterChar = afterIdx < lineText.length ? lineText.charAt(afterIdx) : '';
        const trailingSpace = afterChar && !/\s/.test(afterChar) ? ' ' : '';
        return parsed.projectDefinitions.map(p => {
            const item = new vscode.CompletionItem(`[${p.name}]`, vscode.CompletionItemKind.Module);
            item.detail = p.description;
            item.documentation = new vscode.MarkdownString(`**\`[${p.name}]\`**\n\n${p.description}`);
            item.insertText = `${formatProjectToken(p.name)}${trailingSpace}`;
            // Replace range starts one char before the position to consume the
            // typed `[` (the token itself supplies its own brackets/backticks).
            const replaceStart = new vscode.Position(position.line, Math.max(0, position.character - 1));
            const replaceEnd = new vscode.Position(position.line, position.character + swallowAutoClose);
            item.range = new vscode.Range(replaceStart, replaceEnd);
            item.filterText = `[${p.name} ${p.description}`;
            item.sortText = p.name;
            return item;
        });
    }
};
