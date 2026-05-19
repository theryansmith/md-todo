import * as vscode from 'vscode';
import { TodoItem } from './types';
import {
    isTodoFile,
    parseDocument,
    getItemWithDescendantsEndLine,
    itemMatchesActivity,
} from './parser';
import { startOfToday } from './dates';
import { getFocusUser, getFocusTag, getActivityFocus } from './state';

let dimmedDecorationType: vscode.TextEditorDecorationType | undefined;

export function createDimmedDecorationType(): vscode.TextEditorDecorationType {
    if (dimmedDecorationType) {
        dimmedDecorationType.dispose();
    }
    dimmedDecorationType = vscode.window.createTextEditorDecorationType({
        opacity: '0.25'
    });
    return dimmedDecorationType;
}

/**
 * Dim every line that does NOT belong to a top-level item whose subtree
 * matches the active focus filters.
 *
 * A top-level item is "matched" when its subtree contains at least one node
 * (the item itself or any descendant) that satisfies BOTH the user-focus and
 * tag-focus filters. Either filter alone behaves as before; both set together
 * narrows the visible items via AND semantics. When unmatched, the entire
 * subtree (including notes) is dimmed. When matched, nothing in the subtree
 * is dimmed so the user can read the parent context.
 */
export function updateDimDecorations(editor: vscode.TextEditor) {
    const decorationType = dimmedDecorationType ?? createDimmedDecorationType();
    if (!isTodoFile(editor.document)) {
        editor.setDecorations(decorationType, []);
        return;
    }
    const focusUser = getFocusUser();
    const focusTag = getFocusTag();
    const activity = getActivityFocus();
    if (!focusUser && !focusTag && !activity) {
        editor.setDecorations(decorationType, []);
        return;
    }
    const parsed = parseDocument(editor.document);
    const today = startOfToday();

    function subtreeMatches(item: TodoItem): boolean {
        const userOk = !focusUser || item.mentions.includes(focusUser);
        const tagOk = !focusTag || item.tags.includes(focusTag);
        const activityOk = !activity || itemMatchesActivity(item, activity, today);
        if (userOk && tagOk && activityOk) { return true; }
        for (const child of item.children) {
            if (subtreeMatches(child)) { return true; }
        }
        return false;
    }

    const ranges: vscode.Range[] = [];

    // (a) Subtree-level dim for non-matching top-level subtrees.
    for (const top of parsed.items) {
        if (subtreeMatches(top)) { continue; }
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
                if (m.index !== undefined && m[1] !== focusUser) {
                    ranges.push(new vscode.Range(i, m.index, i, m.index + m[0].length));
                }
            }
        }
        if (focusTag) {
            for (const m of lineText.matchAll(/#([\w-]+)/g)) {
                if (m.index !== undefined && m[1] !== focusTag) {
                    ranges.push(new vscode.Range(i, m.index, i, m.index + m[0].length));
                }
            }
        }
    }

    editor.setDecorations(decorationType, ranges);
}
