import * as vscode from 'vscode';
import { GroupingTreeNode } from '../vscode/grouping-tree';
import { isTodoFile } from '../vscode/document-cache';
import { dimDecoration } from './focus/decoration-dim';
import { markDone } from './items/commands-mark-done';

/**
 * Shared context-menu handlers for the three grouping trees. Each tree's
 * feature module binds these to its own focus state, status bar, and command
 * IDs; the IDs and node contextValues themselves are frozen (referenced from
 * package.json contributes.menus).
 */

/**
 * Set a focus dimension from a tree root's group key, then repaint dim in
 * every visible editor. Mirrors the (deliberately asymmetric) originals: a
 * focus SET repaints all visible editors, a focus CLEAR only todo files.
 */
export async function focusFromTreeRoot<TDef>(
    node: GroupingTreeNode<TDef> | undefined,
    keyOf: (def: TDef) => string,
    warnMessage: string,
    setState: (value: string | undefined) => Promise<void>,
    refreshStatusBar: (editor: vscode.TextEditor | undefined) => void
): Promise<void> {
    if (node?.kind !== 'root') {
        vscode.window.showWarningMessage(warnMessage);
        return;
    }
    await setState(keyOf(node.def));
    refreshStatusBar(vscode.window.activeTextEditor);
    for (const visible of vscode.window.visibleTextEditors) {
        dimDecoration.update(visible);
    }
}

/** Clear a focus dimension set from a tree, then repaint dim in todo editors. */
export async function clearFocusFromTree(
    setState: (value: string | undefined) => Promise<void>,
    refreshStatusBar: (editor: vscode.TextEditor | undefined) => void
): Promise<void> {
    await setState(undefined);
    refreshStatusBar(vscode.window.activeTextEditor);
    for (const visible of vscode.window.visibleTextEditors) {
        if (isTodoFile(visible.document)) {
            dimDecoration.update(visible);
        }
    }
}

/**
 * Mark a tree todo node's item done in the document it came from, then
 * refresh the owning tree. Consolidates the three per-tree copies; the Users
 * copy used the provider's CURRENT uri instead of the node's own sourceUri —
 * unified to sourceUri (Appendix A row U1 of the TDD).
 */
export async function markDoneFromTreeNode(
    provider: { refresh(): void },
    node: GroupingTreeNode<unknown> | undefined
): Promise<void> {
    if (node?.kind !== 'todo') {
        return;
    }
    if (node.item.isComplete) {
        vscode.window.showInformationMessage('Item is already complete');
        return;
    }
    const doc = await vscode.workspace.openTextDocument(node.sourceUri);
    const editor = await vscode.window.showTextDocument(doc, { preview: false });
    await markDone(editor, undefined, node.item.line);
    provider.refresh();
}

/**
 * Open a tree todo node's document, place the cursor on its line, and run an
 * editor command that resolves its target via findItemAtCursor (addTags /
 * setProject).
 */
export async function runCommandAtTreeTodo(
    node: GroupingTreeNode<unknown> | undefined,
    commandId: string
): Promise<void> {
    if (node?.kind !== 'todo') {
        return;
    }
    const doc = await vscode.workspace.openTextDocument(node.sourceUri);
    const editor = await vscode.window.showTextDocument(doc, { preview: false });
    const pos = new vscode.Position(node.item.line, 0);
    editor.selection = new vscode.Selection(pos, pos);
    editor.revealRange(new vscode.Range(pos, pos));
    await vscode.commands.executeCommand(commandId);
}
