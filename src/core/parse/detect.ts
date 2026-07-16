import { TextDocumentLike } from '../text-document';

/**
 * Frontmatter opt-in check: the document starts with a `---` fence and
 * declares `md-todo: true` before the closing fence (searched within the
 * first 20 lines). Pure content check — the `languageId === 'markdown'`
 * half of the old isTodoFile lives with the host in
 * vscode/document-cache.ts, which delegates here.
 */
export function isTodoContent(document: TextDocumentLike): boolean {
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
