import * as vscode from 'vscode';
import { parseDocument } from '../../vscode/document-cache';
import { requireTodoEditor } from '../../vscode/guards';
import { buildArchivePlan } from '../../core/edit/plans';
import { applyPlan } from '../../vscode/edit-executor';

export async function archiveItems(editor: vscode.TextEditor) {
    const ctx = requireTodoEditor(editor);
    if (!ctx) {
        return;
    }
    const effectiveDocument = ctx.document;

    const config = vscode.workspace.getConfiguration('mdTodo');
    const archiveAfterDays = config.get<number>('archiveAfterDays', 7);

    const parsed = parseDocument(effectiveDocument);
    const plan = buildArchivePlan(effectiveDocument, parsed, {
        archiveAfterDays,
        today: new Date(),
    });

    if (!plan) {
        vscode.window.showInformationMessage(
            `No items completed more than ${archiveAfterDays} days ago`
        );
        return;
    }

    await applyPlan(effectiveDocument, plan);
}
