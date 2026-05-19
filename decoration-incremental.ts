import * as vscode from 'vscode';

// Net number of lines added (positive) or removed (negative) by a single
// content change. For a pure insert with no newlines this is 0. For an
// insert of N newlines into a single line, +N. For a delete that collapses
// N+1 lines into 1, -N. Replacement of M lines with text containing K
// newlines is K - M.
export function computeLineDelta(change: vscode.TextDocumentContentChangeEvent): number {
    const newlinesInText = (change.text.match(/\n/g)?.length ?? 0);
    const oldLineSpan = change.range.end.line - change.range.start.line;
    return newlinesInText - oldLineSpan;
}

/**
 * Update a cached decoration list to reflect a single edit, producing the
 * subset of options that survive unchanged (above the edit) or shifted (below
 * the edit). Options whose start line falls inside [dropStartLine, dropEndLine]
 * are dropped — callers must re-scan that range against the post-edit document
 * and merge the new options back in.
 *
 * All line numbers are in OLD-document coordinates (before the edit was
 * applied). The returned options carry NEW-document line numbers (above-the-
 * edit options are unchanged; below-the-edit options have line numbers shifted
 * by `delta`).
 *
 * Single-line decoration patterns only: each DecorationOptions range is
 * assumed to live on a single line (start.line === end.line). Tag, date, and
 * mention decorations satisfy this; dim's per-token ranges do too.
 */
export function dropAndShift(
    options: vscode.DecorationOptions[],
    dropStartLine: number,
    dropEndLine: number,
    delta: number,
): vscode.DecorationOptions[] {
    const result: vscode.DecorationOptions[] = [];
    for (const opt of options) {
        const startLine = opt.range.start.line;
        if (startLine < dropStartLine) {
            // Above the edit — unchanged.
            result.push(opt);
        } else if (startLine > dropEndLine) {
            // Below the edit — shift line numbers by delta.
            if (delta === 0) {
                result.push(opt);
            } else {
                const newStart = new vscode.Position(opt.range.start.line + delta, opt.range.start.character);
                const newEnd = new vscode.Position(opt.range.end.line + delta, opt.range.end.character);
                result.push({ ...opt, range: new vscode.Range(newStart, newEnd) });
            }
        }
        // else: inside [dropStartLine, dropEndLine] — drop, caller will re-scan.
    }
    return result;
}

/**
 * Apply a sequence of content changes to a cached decoration list, working
 * right-to-left so each change's coordinates remain valid as we go. Returns
 * the surviving (above-the-edit, untouched) plus shifted (below-the-edit)
 * options. For each change the caller must also re-scan the affected NEW
 * line range — see scanLineRangeNew below.
 *
 * VS Code does not guarantee any ordering on `event.contentChanges`. In
 * practice it returns them in document order (and the docs hint at that),
 * but we sort defensively here. Right-to-left = descending by range.start.
 */
export function applyChangesToCache(
    cached: vscode.DecorationOptions[],
    changes: readonly vscode.TextDocumentContentChangeEvent[],
): vscode.DecorationOptions[] {
    const sorted = [...changes].sort((a, b) => {
        if (b.range.start.line !== a.range.start.line) {
            return b.range.start.line - a.range.start.line;
        }
        return b.range.start.character - a.range.start.character;
    });

    let working = cached;
    for (const change of sorted) {
        const delta = computeLineDelta(change);
        working = dropAndShift(working, change.range.start.line, change.range.end.line, delta);
    }
    return working;
}

/**
 * For a content change, return the [startLine, endLine] inclusive range of
 * NEW-document lines that need re-scanning. This is the post-edit footprint
 * of the change: `change.range.start.line` to `change.range.start.line +
 * newlinesInText`. Always at least one line.
 */
export function affectedNewLineRange(change: vscode.TextDocumentContentChangeEvent): { startLine: number; endLine: number } {
    const newlinesInText = (change.text.match(/\n/g)?.length ?? 0);
    const startLine = change.range.start.line;
    return { startLine, endLine: startLine + newlinesInText };
}

/**
 * Merge re-scanned options (covering one or more affected ranges in the new
 * document) into the shifted cache. Returns a fresh array sorted by start
 * line then start character. VS Code does not require sorted input but keeping
 * a canonical order makes the cache deterministic and easier to reason about.
 */
export function mergeAndSort(
    shifted: vscode.DecorationOptions[],
    rescanned: vscode.DecorationOptions[],
): vscode.DecorationOptions[] {
    const merged = shifted.concat(rescanned);
    merged.sort((a, b) => {
        if (a.range.start.line !== b.range.start.line) {
            return a.range.start.line - b.range.start.line;
        }
        return a.range.start.character - b.range.start.character;
    });
    return merged;
}
