import { TextDocumentLike } from '../text-document';

/**
 * F-17: token regexes used to match `#tag` / `@user` / dates / todo lines
 * inside fenced code blocks and HTML comments — false positives in the
 * trees, decorations, and dim overlay. This module computes, per document,
 * which LINES are excluded from parsing and token scanning.
 *
 * Line-granular semantics (pinned by test/unit/fences.test.ts):
 *
 * - A fenced code block opens at a line whose first non-whitespace content
 *   is ``` or ~~~ (info strings allowed) and closes at a line containing
 *   ONLY the same fence character repeated 3+ times (plus whitespace).
 *   Both delimiter lines and everything between are excluded. An unclosed
 *   fence runs to EOF (CommonMark behavior). A ~~~ line does not close a
 *   ``` fence, and vice versa.
 * - An HTML comment block excludes: every line whose first non-whitespace
 *   content is `<!--`, and — when a `<!--` (anywhere on a non-excluded
 *   line) is not closed by `-->` on the same line — every following line
 *   up to and including the one containing `-->`. A line with real content
 *   BEFORE a trailing `<!--` opener is NOT excluded itself (its prefix is
 *   real); only the continuation lines are. Finer, span-level handling of
 *   inline comments and inline code spans is explicitly out of scope
 *   (see the TDD Decision Log).
 * - Fence delimiters inside comments are ignored, and comment markers
 *   inside fences are ignored.
 */

/**
 * Cheap structural test: does this text contain any fence or comment
 * marker? Used by the incremental decoration path to decide when the
 * excluded-line structure may have changed (see DecorationController).
 */
export const FENCE_OR_COMMENT_MARKER_RE = /```|~~~|<!--|-->/;

export interface ExcludedLines {
    /** excluded[i] — line i is inside (or delimits) a fence/comment block. */
    excluded: boolean[];
    /**
     * Number of lines containing any fence/comment marker. A pure text
     * property (state-independent), so comparing counts across an edit is a
     * reliable "fence/comment structure may have changed" signal even for
     * deletions, where the removed text is no longer observable.
     */
    markerLineCount: number;
}

const FENCE_OPEN_RE = /^\s*(`{3,}|~{3,})/;
const FENCE_CLOSE_RE = /^\s*(`{3,}|~{3,})\s*$/;
const COMPLETE_COMMENT_RE = /<!--[\s\S]*?-->/g;

export function computeExcludedLines(document: TextDocumentLike): ExcludedLines {
    const excluded: boolean[] = new Array(document.lineCount).fill(false) as boolean[];
    let markerLineCount = 0;
    let fenceChar: '`' | '~' | null = null;
    let inComment = false;

    for (let i = 0; i < document.lineCount; i++) {
        const text = document.lineAt(i).text;
        if (FENCE_OR_COMMENT_MARKER_RE.test(text)) {
            markerLineCount++;
        }

        if (fenceChar) {
            excluded[i] = true;
            const close = FENCE_CLOSE_RE.exec(text);
            if (close?.[1].startsWith(fenceChar)) {
                fenceChar = null;
            }
            continue;
        }

        if (inComment) {
            excluded[i] = true;
            if (text.includes('-->')) {
                inComment = false;
            }
            continue;
        }

        const open = FENCE_OPEN_RE.exec(text);
        if (open) {
            excluded[i] = true;
            fenceChar = open[1].charAt(0) as '`' | '~';
            continue;
        }

        // Comment handling: strip complete inline `<!-- … -->` pairs first;
        // a leftover `<!--` opens a multi-line comment for FOLLOWING lines.
        excluded[i] = text.trimStart().startsWith('<!--');
        if (text.replace(COMPLETE_COMMENT_RE, '').includes('<!--')) {
            inComment = true;
        }
    }

    return { excluded, markerLineCount };
}
