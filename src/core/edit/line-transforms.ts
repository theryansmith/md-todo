/**
 * Pure line-level rewrites of todo lines. Host-free: a transform takes a line
 * string and returns the rewritten line string; applying it to a document is
 * the vscode layer's job.
 *
 * `markLineComplete` was moved here from
 * `src/features/items/commands-mark-done.ts` as a content move (not a
 * `git mv` — the function was a small part of that file), noted in the TDD
 * Decision Log.
 */

/**
 * Normalize a mixed-case checkbox to the canonical lowercase form (F-16):
 * a LEADING `[X]` checkbox token becomes `[x]`. Anchored to the list-marker
 * prefix on purpose — `[X]` occurrences later in the item text are content,
 * not checkboxes, and untouched lines are never mass-rewritten; this runs
 * only on lines a write path is already rewriting.
 */
export function normalizeCheckbox(lineText: string): string {
    return lineText.replace(/^(\s*-\s*)\[X\]/, '$1[x]');
}

/**
 * Pure line transform: check the box and stamp a completed date. If the line
 * carries a `+added` date, the `✓` date is placed right after it; otherwise
 * it is appended at the end. Already-completed lines pass through with their
 * checkbox normalized to `[x]` (F-16) but their existing `✓` date kept.
 */
export function markLineComplete(lineText: string, today: string): string {
    let result = normalizeCheckbox(lineText);
    result = result.replace(/\[\s\]/, '[x]');
    if (!result.includes('`✓')) {
        if (result.includes('`+')) {
            result = result.replace(/(`\+\d{4}-\d{2}-\d{2}`)/, `$1 \`✓${today}\``);
        } else {
            result = result.trimEnd() + ` \`✓${today}\``;
        }
    }
    return result;
}
