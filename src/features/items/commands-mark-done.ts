import * as vscode from 'vscode';
import { TodoItem } from '../../core/model';
import { parseDocument } from '../../vscode/document-cache';
import { requireTodoEditor } from '../../vscode/guards';
import { findItemAtCursor } from '../../vscode/editor-queries';
import { findItemForSourceLine } from '../../core/query/items';
import { getToday } from '../../core/dates';
import { buildMarkDonePlan } from '../../core/edit/plans';
import { applyPlan } from '../../vscode/edit-executor';

export async function markDone(
    editor: vscode.TextEditor,
    _edit?: vscode.TextEditorEdit,
    targetLine?: number
) {
    const ctx = requireTodoEditor(editor);
    if (!ctx) {
        return;
    }
    const effectiveEditor = ctx.editor;
    const effectiveDocument = ctx.document;

    let result: { item: TodoItem; lineNum: number } | null = null;

    if (targetLine !== undefined) {
        const parsed = parseDocument(effectiveDocument);
        const item = findItemForSourceLine(targetLine, parsed);
        if (item) {
            result = { item, lineNum: item.line };
        }
    } else {
        result = findItemAtCursor(effectiveEditor);
    }

    if (!result) {
        const parsed = parseDocument(effectiveDocument);
        const incompleteItems = parsed.items.filter((item) => !item.isComplete);

        if (incompleteItems.length === 0) {
            vscode.window.showInformationMessage('No incomplete items found');
            return;
        }

        const picks = incompleteItems.map((item) => ({
            label: item.text,
            description: item.addedDate ? `Added ${item.addedDate}` : '',
            item,
        }));

        const selected = await vscode.window.showQuickPick(picks, {
            placeHolder: 'Select item to mark complete',
        });

        if (!selected) {
            return;
        }

        await markItemDone(effectiveEditor, selected.item);
    } else {
        if (result.item.isComplete) {
            vscode.window.showInformationMessage('Item is already complete');
            return;
        }
        await markItemDone(effectiveEditor, result.item);
    }
}

/**
 * Build the four-case mark-done plan from one document snapshot and apply it
 * as a single WorkspaceEdit (F-07): the move-to-Completed case used to be a
 * delete → re-parse → insert two-step, so one undo restored only half of it.
 * The plan builder carries the whole case matrix; golden tests pin it in
 * test/unit/edit-plans.test.ts.
 */
async function markItemDone(editor: vscode.TextEditor, item: TodoItem) {
    const document = editor.document;
    const parsed = parseDocument(document);
    const plan = buildMarkDonePlan(document, parsed, item, getToday());
    await applyPlan(document, plan);
}
