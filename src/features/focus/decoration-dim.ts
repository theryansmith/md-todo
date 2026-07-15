import * as vscode from 'vscode';
import { TodoItem } from '../../core/model';
import { isTodoFile, parseDocument } from '../../vscode/document-cache';
import { DecorationController } from '../../vscode/decoration-controller';
import { getItemWithDescendantsEndLine } from '../../core/query/items';
import { itemMatchesActivity, getEffectiveProject } from '../../core/query/activity';
import { startOfToday } from '../../core/dates';
import { getFocusUser, getFocusTag, getFocusProject, getActivityFocus } from '../../vscode/workspace-state';
import { PROJECT_TOKEN_RE_G } from '../../core/tokens';

/** True when no focus dimension is set — dim's set is then trivially empty. */
function noFocusSet(): boolean {
    return !getFocusUser() && !getFocusTag() && !getFocusProject() && !getActivityFocus();
}

/**
 * Dim every line that does NOT belong to a top-level item whose subtree
 * matches the active focus filters.
 *
 * A top-level item is "matched" when its subtree contains at least one node
 * (the item itself or any descendant) that satisfies ALL of the user-focus,
 * tag-focus, and project-focus filters (project membership is inherited from
 * the nearest ancestor's `[name]` token). Any filter alone behaves as before;
 * several set together narrow the visible items via AND semantics. When
 * unmatched, the entire subtree (including notes) is dimmed. When matched,
 * nothing in the subtree is dimmed so the user can read the parent context.
 */
function scanDocument(document: vscode.TextDocument): vscode.DecorationOptions[] {
    const focusUser = getFocusUser();
    const focusTag = getFocusTag();
    const focusProject = getFocusProject();
    const activity = getActivityFocus();
    if (!focusUser && !focusTag && !focusProject && !activity) {
        return [];
    }
    const parsed = parseDocument(document);
    const today = startOfToday();

    function subtreeMatches(item: TodoItem): boolean {
        const userOk = !focusUser || item.mentions.includes(focusUser);
        const tagOk = !focusTag || item.tags.includes(focusTag);
        const projectOk = !focusProject || getEffectiveProject(item) === focusProject;
        const activityOk = !activity || itemMatchesActivity(item, activity, today);
        if (userOk && tagOk && projectOk && activityOk) {
            return true;
        }
        return item.children.some(subtreeMatches);
    }

    const options: vscode.DecorationOptions[] = [];

    // (a) Subtree-level dim for non-matching top-level subtrees.
    for (const top of parsed.items) {
        if (subtreeMatches(top)) {
            continue;
        }
        const endLine = getItemWithDescendantsEndLine(document, top);
        const endLineLength = document.lineAt(endLine).text.length;
        options.push({ range: new vscode.Range(top.line, 0, endLine, endLineLength) });
    }

    // (b) Span-level dim across the whole document. Already-dimmed spans from
    //     (a) ride along harmlessly (idempotent).
    const tokenFilters: [string | undefined, RegExp][] = [
        [focusUser, /@([\w-]+)/g],
        [focusTag, /#([\w-]+)/g],
        [focusProject, PROJECT_TOKEN_RE_G],
    ];
    for (let i = 0; i < document.lineCount; i++) {
        const lineText = document.lineAt(i).text;
        for (const [focus, pattern] of tokenFilters) {
            if (!focus) {
                continue;
            }
            for (const m of lineText.matchAll(pattern)) {
                if (m[1] !== focus) {
                    options.push({ range: new vscode.Range(i, m.index, i, m.index + m[0].length) });
                }
            }
        }
    }

    return options;
}

/**
 * Dim's decoration set has two shapes: multi-line subtree ranges anchored to
 * parsed top-level items, and single-line per-token spans. Shifting the
 * subtree ranges past an arbitrary edit is fragile — an edit can re-parent a
 * subtree, move a `##` header, or change which items match focus — so dim is
 * the `incremental: false` spec: the controller full-scans on edit
 * (parseDocument is memoized, so that costs one parse + one O(N) walk), and
 * `isEmptyState` preserves the documented no-focus short-circuit where an
 * already-emitted empty set skips setDecorations entirely.
 *
 * Focus-state changes (status bar clicks, setFocus* commands) call
 * `dimDecoration.update(editor)` directly — those callers haven't changed.
 */
export const dimDecoration = new DecorationController({
    id: 'dim',
    incremental: false,
    createType: () => vscode.window.createTextEditorDecorationType({ opacity: '0.25' }),
    scanDocument,
    isEmptyState: noFocusSet,
});

/**
 * Repaint dim in every visible editor that is a todo file — the shared
 * on-change side effect of all four focus dimensions (both set and clear
 * command paths, Appendix B). The tree context-menu SET path deliberately
 * repaints ALL visible editors instead — that asymmetric variant lives in
 * features/tree-commands.ts, unchanged.
 */
export function repaintDimInVisibleTodoEditors(): void {
    for (const visible of vscode.window.visibleTextEditors) {
        if (isTodoFile(visible.document)) {
            dimDecoration.update(visible);
        }
    }
}
