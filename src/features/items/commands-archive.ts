import * as vscode from 'vscode';
import { parseDocument } from '../../vscode/document-cache';
import { requireTodoEditor } from '../../vscode/guards';
import { getItemEndLine } from '../../core/query/items';
import { parseDate, daysBetween } from '../../core/dates';

export async function archiveItems(editor: vscode.TextEditor) {
    const ctx = requireTodoEditor(editor);
    if (!ctx) {
        return;
    }
    const effectiveEditor = ctx.editor;
    const effectiveDocument = ctx.document;

    const config = vscode.workspace.getConfiguration('mdTodo');
    const archiveAfterDays = config.get<number>('archiveAfterDays', 7);

    const parsed = parseDocument(effectiveDocument);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const toArchive = parsed.items.filter((item) => {
        if (!item.isComplete || !item.completedDate) {
            return false;
        }
        const completed = parseDate(item.completedDate);
        if (!completed) {
            return false;
        }
        return daysBetween(today, completed) >= archiveAfterDays;
    });

    if (toArchive.length === 0) {
        vscode.window.showInformationMessage(
            `No items completed more than ${archiveAfterDays} days ago`
        );
        return;
    }

    const archiveSection = parsed.sections.get('archive');

    const archiveTexts: string[] = [];
    const linesToDelete: number[] = [];

    for (const item of toArchive) {
        const endLine = getItemEndLine(effectiveDocument, item.line);
        const lines: string[] = [];
        for (let i = item.line; i <= endLine; i++) {
            lines.push(effectiveDocument.lineAt(i).text);
            linesToDelete.push(i);
        }
        archiveTexts.push(lines.join('\n'));
    }

    linesToDelete.sort((a, b) => b - a);

    await effectiveEditor.edit((editBuilder: vscode.TextEditorEdit) => {
        const processed = new Set<number>();
        for (const lineNum of linesToDelete) {
            if (processed.has(lineNum)) {
                continue;
            }
            processed.add(lineNum);
            const range = new vscode.Range(lineNum, 0, lineNum + 1, 0);
            editBuilder.delete(range);
        }

        const archiveText: string = '\n' + archiveTexts.join('\n') + '\n';

        if (archiveSection) {
            const insertPos: vscode.Position = new vscode.Position(archiveSection.start + 1, 0);
            editBuilder.insert(insertPos, archiveText);
        } else {
            const endPos: vscode.Position = new vscode.Position(effectiveDocument.lineCount, 0);
            editBuilder.insert(endPos, `\n## Archive\n${archiveText}`);
        }
    });

    vscode.window.showInformationMessage(`Archived ${toArchive.length} items`);
}
