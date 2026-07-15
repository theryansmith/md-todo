import * as vscode from 'vscode';
import { TodoItem } from '../../core/types';
import {
    isTodoFile,
    parseDocument,
    getItemWithDescendantsEndLine,
    itemMatchesActivity,
    getEffectiveProject,
} from '../../core/parser';
import { startOfToday } from '../../core/dates';
import { getFocusUser, getFocusTag, getFocusProject, getActivityFocus } from '../../vscode/state';
import { PROJECT_TOKEN_RE_G } from '../../core/tokens';

let dimmedDecorationType: vscode.TextEditorDecorationType | undefined;

// Tracks the most recently emitted set per URI so that an edit on a document
// where no focus is set (the common case during normal typing) can short-
// circuit: emit an empty list once, then skip subsequent setDecorations until
// state changes. The cache value is the emitted Range[] for completeness, but
// in practice the no-focus path stores an empty array.
const dimDecorationCache = new Map<string, vscode.Range[]>();

export function clearDimDecorationCache(uri?: vscode.Uri): void {
    if (uri) {
        dimDecorationCache.delete(uri.toString());
    } else {
        dimDecorationCache.clear();
    }
}

export function createDimmedDecorationType(): vscode.TextEditorDecorationType {
    if (dimmedDecorationType) {
        dimmedDecorationType.dispose();
    }
    dimmedDecorationType = vscode.window.createTextEditorDecorationType({
        opacity: '0.25',
    });
    return dimmedDecorationType;
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
export function updateDimDecorations(editor: vscode.TextEditor) {
    const decorationType = dimmedDecorationType ?? createDimmedDecorationType();
    const key = editor.document.uri.toString();
    if (!isTodoFile(editor.document)) {
        editor.setDecorations(decorationType, []);
        dimDecorationCache.set(key, []);
        return;
    }
    const focusUser = getFocusUser();
    const focusTag = getFocusTag();
    const focusProject = getFocusProject();
    const activity = getActivityFocus();
    if (!focusUser && !focusTag && !focusProject && !activity) {
        editor.setDecorations(decorationType, []);
        dimDecorationCache.set(key, []);
        return;
    }
    const parsed = parseDocument(editor.document);
    const today = startOfToday();

    function subtreeMatches(item: TodoItem): boolean {
        const userOk = !focusUser || item.mentions.includes(focusUser);
        const tagOk = !focusTag || item.tags.includes(focusTag);
        const projectOk = !focusProject || getEffectiveProject(item) === focusProject;
        const activityOk = !activity || itemMatchesActivity(item, activity, today);
        if (userOk && tagOk && projectOk && activityOk) {
            return true;
        }
        for (const child of item.children) {
            if (subtreeMatches(child)) {
                return true;
            }
        }
        return false;
    }

    const ranges: vscode.Range[] = [];

    // (a) Subtree-level dim for non-matching top-level subtrees.
    for (const top of parsed.items) {
        if (subtreeMatches(top)) {
            continue;
        }
        const endLine = getItemWithDescendantsEndLine(editor.document, top);
        const endLineLength = editor.document.lineAt(endLine).text.length;
        ranges.push(new vscode.Range(top.line, 0, endLine, endLineLength));
    }

    // (b) Span-level dim across the whole document. Already-dimmed spans from
    //     (a) ride along harmlessly (idempotent).
    for (let i = 0; i < editor.document.lineCount; i++) {
        const lineText = editor.document.lineAt(i).text;
        if (focusUser) {
            for (const m of lineText.matchAll(/@([\w-]+)/g)) {
                if (m[1] !== focusUser) {
                    ranges.push(new vscode.Range(i, m.index, i, m.index + m[0].length));
                }
            }
        }
        if (focusTag) {
            for (const m of lineText.matchAll(/#([\w-]+)/g)) {
                if (m[1] !== focusTag) {
                    ranges.push(new vscode.Range(i, m.index, i, m.index + m[0].length));
                }
            }
        }
        if (focusProject) {
            for (const m of lineText.matchAll(PROJECT_TOKEN_RE_G)) {
                if (m[1] !== focusProject) {
                    ranges.push(new vscode.Range(i, m.index, i, m.index + m[0].length));
                }
            }
        }
    }

    editor.setDecorations(decorationType, ranges);
    dimDecorationCache.set(key, ranges);
}

/**
 * Incremental edit path for dim. Dim's decoration set has two shapes:
 *   (a) multi-line subtree ranges anchored to parsed top-level items
 *   (b) single-line per-token spans
 *
 * Shifting (a) past an arbitrary edit is fragile — an edit can re-parent a
 * subtree, move a `##` header, or change which items match focus. We do NOT
 * attempt to shift (a). The wins come from two cases:
 *
 *   - No focus state set: the decoration set is empty regardless of the edit.
 *     Emit an empty list once and cache it; subsequent no-focus edits can
 *     skip the setDecorations call entirely if the cache already records an
 *     empty list.
 *
 *   - Focus state set: fall back to full-scan. parseDocument is memoized
 *     (Perf-1) so on a fresh edit the cache misses (version bumped) and we
 *     pay one parse + one O(N) range walk. That's the same cost as before
 *     Perf-3 but with the explicit acknowledgement that dim's edit path is
 *     not incremental in the same sense as tag/date/mention.
 *
 * Focus-state changes (user clicks the status bar, runs setFocusTag, etc.)
 * call updateDimDecorations directly — those callers haven't changed.
 */
export function updateDimDecorationsIncremental(
    editor: vscode.TextEditor,
    _changes: readonly vscode.TextDocumentContentChangeEvent[]
): void {
    const decorationType = dimmedDecorationType ?? createDimmedDecorationType();
    const key = editor.document.uri.toString();

    if (!isTodoFile(editor.document)) {
        const cached = dimDecorationCache.get(key);
        if (cached?.length === 0) {
            return;
        }
        editor.setDecorations(decorationType, []);
        dimDecorationCache.set(key, []);
        return;
    }

    const focusUser = getFocusUser();
    const focusTag = getFocusTag();
    const focusProject = getFocusProject();
    const activity = getActivityFocus();
    if (!focusUser && !focusTag && !focusProject && !activity) {
        const cached = dimDecorationCache.get(key);
        if (cached?.length === 0) {
            return;
        }
        editor.setDecorations(decorationType, []);
        dimDecorationCache.set(key, []);
        return;
    }

    updateDimDecorations(editor);
}
