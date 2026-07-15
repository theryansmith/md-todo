import * as vscode from 'vscode';
import { EditPlan, EditOp } from '../core/edit/plans';

/**
 * Apply a core EditPlan as ONE `vscode.WorkspaceEdit` (F-07). Every op is
 * expressed in original-document line coordinates against the snapshot the
 * plan was built from, so the whole mutation — mark-done's move-to-Completed,
 * archive's collect-and-move — is a single undo step and is never observable
 * half-applied.
 *
 * Whole-line op semantics (mirrored by the string-array applier in
 * `test/unit/edit-plans.test.ts`):
 * - `replaceLines` replaces the text of lines [startLine..endLine].
 * - `deleteLines` removes lines [startLine..endLine] including their
 *   newlines; a block ending on the last line consumes the PRECEDING newline
 *   instead, so no stray blank is left.
 * - `insertLines` inserts full lines before `atLine`; `atLine >= lineCount`
 *   appends after the last line.
 *
 * After applying, the plan's summary is shown as the info toast the callers
 * used to show themselves.
 */
export async function applyPlan(document: vscode.TextDocument, plan: EditPlan): Promise<boolean> {
    const edit = new vscode.WorkspaceEdit();
    for (const op of plan.ops) {
        addOp(edit, document, op);
    }
    const applied = await vscode.workspace.applyEdit(edit);
    vscode.window.showInformationMessage(plan.summary);
    return applied;
}

function addOp(edit: vscode.WorkspaceEdit, document: vscode.TextDocument, op: EditOp): void {
    const uri = document.uri;
    const lineLength = (line: number) => document.lineAt(line).text.length;

    switch (op.kind) {
        case 'replaceLines': {
            edit.replace(
                uri,
                new vscode.Range(op.startLine, 0, op.endLine, lineLength(op.endLine)),
                op.lines.join('\n')
            );
            return;
        }
        case 'deleteLines': {
            const range =
                op.endLine + 1 < document.lineCount
                    ? new vscode.Range(op.startLine, 0, op.endLine + 1, 0)
                    : op.startLine > 0
                      ? // Block reaches the last line: take the preceding
                        // newline so the deletion doesn't leave a blank line.
                        new vscode.Range(
                            op.startLine - 1,
                            lineLength(op.startLine - 1),
                            op.endLine,
                            lineLength(op.endLine)
                        )
                      : new vscode.Range(0, 0, op.endLine, lineLength(op.endLine));
            edit.delete(uri, range);
            return;
        }
        case 'insertLines': {
            if (op.atLine < document.lineCount) {
                edit.insert(uri, new vscode.Position(op.atLine, 0), op.lines.join('\n') + '\n');
            } else {
                const last = document.lineCount - 1;
                edit.insert(
                    uri,
                    new vscode.Position(last, lineLength(last)),
                    '\n' + op.lines.join('\n')
                );
            }
            return;
        }
    }
}
