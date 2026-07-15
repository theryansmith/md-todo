import { ParsedDocument, TodoItem } from '../model';
import { TextDocumentLike } from '../text-document';
import { parseDate, daysBetween } from '../dates';
import { getItemEndLine, getItemWithDescendantsEndLine, isNestedItem } from '../query/items';
import { markLineComplete } from './line-transforms';

/**
 * EditPlan — atomic document mutations (F-07).
 *
 * A plan is pure data computed from ONE parsed snapshot of a document. The
 * vscode layer (`vscode/edit-executor.ts`) applies every op in a single
 * `WorkspaceEdit`, so a multi-op mutation (mark-done's move-to-Completed,
 * archive's collect-and-move) is one undo step and is never observable
 * half-applied. All line numbers are ORIGINAL-document coordinates; ops never
 * overlap, so they can be applied in any position-consistent order.
 */

export type EditOp =
    /** Replace lines [startLine..endLine] (inclusive) with `lines`. */
    | { kind: 'replaceLines'; startLine: number; endLine: number; lines: string[] }
    /** Delete lines [startLine..endLine] (inclusive), newlines included. */
    | { kind: 'deleteLines'; startLine: number; endLine: number }
    /**
     * Insert `lines` as full lines BEFORE line `atLine`. `atLine` may equal
     * the document's lineCount, meaning append after the last line.
     */
    | { kind: 'insertLines'; atLine: number; lines: string[] };

export interface EditPlan {
    /** Line-ranged deletions/replacements/insertions, non-overlapping. */
    ops: EditOp[];
    /** Human summary for the info toast, e.g. `Completed: fix login`. */
    summary: string;
}

/** True for `- [ ]` / `- [x]` / `- [X]` lines at any indent. */
const CHECKBOX_LINE_RE = /^\s*-\s*\[[ xX]\]/;

/**
 * Ops reproducing the old `editor.edit()` deletion of the whole-line block
 * [startLine..endLine], including its end-of-document quirk: the old delete
 * ranges ended at `(endLine + 1, 0)`, which VS Code clamps to the end of the
 * document when `endLine` is the last line — so a block that reaches the end
 * of the document left one EMPTY line behind (the final line's content was
 * removed but its line survived). Returns the ops plus the number of lines
 * actually removed, which the move-to-Completed insert math needs.
 */
function deleteBlockOps(
    document: TextDocumentLike,
    startLine: number,
    endLine: number
): { ops: EditOp[]; removedLines: number } {
    if (endLine < document.lineCount - 1) {
        return {
            ops: [{ kind: 'deleteLines', startLine, endLine }],
            removedLines: endLine - startLine + 1,
        };
    }
    const ops: EditOp[] = [];
    if (endLine > startLine) {
        ops.push({ kind: 'deleteLines', startLine, endLine: endLine - 1 });
    }
    if (document.lineAt(endLine).text !== '') {
        ops.push({ kind: 'replaceLines', startLine: endLine, endLine, lines: [''] });
    }
    return { ops, removedLines: endLine - startLine };
}

/**
 * Build the complete mark-done plan for `item` against one document snapshot.
 * Reproduces all four cases of the pre-plan `markItemDone`:
 *
 * 1. Nested item (has a parent): mark the item and every checkbox descendant
 *    in place — nested items never move.
 * 2. No `## Completed` section: mark in place.
 * 3. Item already inside the Completed section: mark in place.
 * 4. Top-level item elsewhere: mark the whole subtree, delete it, and insert
 *    it at the top of the Completed section (after the header's blank line
 *    when one exists, creating one otherwise).
 *
 * Case 4 is where the old code was broken (F-07): it deleted, RE-PARSED, and
 * inserted in a second edit. Building both ops from the same snapshot means
 * the insert line must be reasoned in post-delete coordinates and mapped
 * back:
 *
 * - When the item sits ABOVE the Completed header, the deletion shifts the
 *   header up by the removed line count `d`, so the old code's re-parse saw
 *   the section start at `start - d` and inserted at `(start - d) + 1|2` —
 *   which maps back to original line `start + 1|2` once the deletion above
 *   is accounted for.
 * - When the item sits BELOW the section, nothing shifts and the insert line
 *   is `start + 1|2` directly.
 *
 * Both cases therefore land on the same original-coordinate insert line; what
 * genuinely depends on the deletion is (a) whether a line after the header
 * still EXISTS in the post-delete document (the header can become the last
 * line) and (b) the old code's end-of-document position clamping. Those two
 * edge cases are reproduced explicitly below and pinned by the golden tests.
 */
export function buildMarkDonePlan(
    document: TextDocumentLike,
    parsed: ParsedDocument,
    item: TodoItem,
    today: string
): EditPlan {
    const completedSection = parsed.sections.get('completed');
    const endLine = getItemWithDescendantsEndLine(document, item);

    const itemLines: string[] = [];
    for (let i = item.line; i <= endLine; i++) {
        const lineText = document.lineAt(i).text;
        itemLines.push(
            CHECKBOX_LINE_RE.test(lineText) ? markLineComplete(lineText, today) : lineText
        );
    }

    const summary = `Completed: ${item.text}`;

    // CASES 1-3: mark in place (nested item / no Completed section / already
    // inside the Completed section).
    const inPlace =
        isNestedItem(item) ||
        !completedSection ||
        (item.line >= completedSection.start && item.line <= completedSection.end);
    if (inPlace) {
        return {
            ops: [{ kind: 'replaceLines', startLine: item.line, endLine, lines: itemLines }],
            summary,
        };
    }

    // CASE 4: move the marked subtree to the top of the Completed section.
    const { ops, removedLines } = deleteBlockOps(document, item.line, endLine);
    const start = completedSection.start; // header line, original coordinates

    // Post-delete coordinates, as the old code's re-parse saw them. The item
    // is strictly outside the Completed section (cases above), so the header
    // and the line after it are never inside the deleted range.
    const postDeleteStart = item.line < start ? start - removedLines : start;
    const postDeleteLineCount = document.lineCount - removedLines;
    const lineExistsAfterHeader = postDeleteStart + 1 < postDeleteLineCount;
    const hasBlankAfterHeader =
        lineExistsAfterHeader && document.lineAt(start + 1).text.trim() === '';

    if (hasBlankAfterHeader) {
        if (postDeleteStart + 2 < postDeleteLineCount) {
            // Normal shape: header, blank, then the item.
            ops.push({ kind: 'insertLines', atLine: start + 2, lines: itemLines });
        } else {
            // The blank line is the last line of the post-delete document: the
            // old insert at (start + 2, 0) clamped to the END of that blank
            // line's predecessor boundary — i.e. the item landed BEFORE the
            // blank, leaving `header, item, blank`.
            ops.push({ kind: 'insertLines', atLine: start + 1, lines: itemLines });
        }
    } else if (lineExistsAfterHeader) {
        // No blank after the header: the old code prepended '\n', which
        // creates one — `header, blank, item, <old next line>`.
        ops.push({ kind: 'insertLines', atLine: start + 1, lines: ['', ...itemLines] });
    } else {
        // The header is the last line of the post-delete document: the old
        // insert at (start + 1, 0) clamped to the end of the header and its
        // '\n'-wrapped text appended after it, leaving a trailing blank line —
        // `header, item, ''`.
        ops.push({ kind: 'insertLines', atLine: document.lineCount, lines: [...itemLines, ''] });
    }

    return { ops, summary };
}

export interface ArchivePlanOptions {
    /** Items completed at least this many days ago are archived. */
    archiveAfterDays: number;
    /** "Now" — normalized to local midnight internally, like the old code. */
    today: Date;
}

/**
 * Build the archive plan: every top-level item completed `archiveAfterDays`
 * or more days ago moves (with its notes/children block, per
 * `getItemEndLine`) to the top of the `## Archive` section, which is created
 * at the end of the document when missing. Returns null when nothing
 * qualifies (the command shows its "nothing to archive" message instead).
 *
 * Semantics preserved from the pre-plan `archiveItems`: only `parsed.items`
 * (top-level items) are considered; moved blocks keep document order; the
 * insert starts with a blank line after the Archive header.
 */
export function buildArchivePlan(
    document: TextDocumentLike,
    parsed: ParsedDocument,
    options: ArchivePlanOptions
): EditPlan | null {
    const { archiveAfterDays, today } = options;
    const midnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());

    const toArchive = parsed.items.filter((item) => {
        if (!item.isComplete || !item.completedDate) {
            return false;
        }
        const completed = parseDate(item.completedDate);
        if (!completed) {
            return false;
        }
        return daysBetween(midnight, completed) >= archiveAfterDays;
    });

    if (toArchive.length === 0) {
        return null;
    }

    const archiveSection = parsed.sections.get('archive');

    const movedLines: string[] = [];
    const ops: EditOp[] = [];
    for (const item of toArchive) {
        const endLine = getItemEndLine(document, item.line);
        for (let i = item.line; i <= endLine; i++) {
            movedLines.push(document.lineAt(i).text);
        }
        ops.push(...deleteBlockOps(document, item.line, endLine).ops);
    }

    if (archiveSection) {
        const atLine = archiveSection.start + 1;
        if (atLine < document.lineCount) {
            ops.push({ kind: 'insertLines', atLine, lines: ['', ...movedLines] });
        } else {
            // Archive header is the last line: the old insert at
            // (start + 1, 0) clamped to the end of the header, appending
            // `header, <moved>, ''`.
            ops.push({
                kind: 'insertLines',
                atLine: document.lineCount,
                lines: [...movedLines, ''],
            });
        }
    } else {
        // No Archive section: the old code appended
        // `\n## Archive\n` + `\n<moved>\n` at the end of the document.
        ops.push({
            kind: 'insertLines',
            atLine: document.lineCount,
            lines: ['## Archive', '', ...movedLines, ''],
        });
    }

    return { ops, summary: `Archived ${toArchive.length} items` };
}
