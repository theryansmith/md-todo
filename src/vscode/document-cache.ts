import * as vscode from 'vscode';
import { ParsedDocument } from '../core/model';
import { parseDocument as parseDocumentPure } from '../core/parse/parser';
import { isTodoContent } from '../core/parse/detect';
import { registerUriCache } from './cache-registry';

/**
 * A markdown document that opts in via `md-todo: true` frontmatter. The
 * languageId gate is a host concept; the frontmatter check is pure and lives
 * in core/parse/detect.ts.
 */
export function isTodoFile(document: vscode.TextDocument): boolean {
    return document.languageId === 'markdown' && isTodoContent(document);
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

// Invalidated with every other per-URI cache on document close (F-11).
registerUriCache(clearParseCache);

export function parseDocument(document: vscode.TextDocument): ParsedDocument {
    const key = document.uri.toString();
    const cached = parseCache.get(key);
    if (cached?.version === document.version) {
        return cached.parsed;
    }
    const parsed = parseDocumentPure(document);
    parseCache.set(key, { version: document.version, parsed });
    return parsed;
}
