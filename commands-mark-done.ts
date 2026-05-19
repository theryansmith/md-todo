import * as vscode from 'vscode';
import { TodoItem } from './types';
import {
    isTodoFile,
    parseDocument,
    findItemForSourceLine,
    findItemAtCursor,
    getEffectiveEditor,
    getItemWithDescendantsEndLine,
    isNestedItem,
} from './parser';
import { getToday } from './dates';

export async function markDone(editor: vscode.TextEditor, _edit?: vscode.TextEditorEdit, targetLine?: number) {
    const ctx = await getEffectiveEditor(editor);
    const effectiveEditor = ctx.editor;
    const effectiveDocument = ctx.document;

    if (!isTodoFile(effectiveDocument)) {
        vscode.window.showWarningMessage('Not a todo file. Add "md-todo: true" to YAML frontmatter.');
        return;
    }

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
        const incompleteItems = parsed.items.filter(item => !item.isComplete);

        if (incompleteItems.length === 0) {
            vscode.window.showInformationMessage('No incomplete items found');
            return;
        }

        const picks = incompleteItems.map((item, idx) => ({
            label: item.text,
            description: item.addedDate ? `Added ${item.addedDate}` : '',
            item
        }));

        const selected = await vscode.window.showQuickPick(picks, {
            placeHolder: 'Select item to mark complete'
        });

        if (!selected) { return; }

        await markItemDone(effectiveEditor, selected.item);
    } else {
        if (result.item.isComplete) {
            vscode.window.showInformationMessage('Item is already complete');
            return;
        }
        await markItemDone(effectiveEditor, result.item);
    }
}

async function markItemDone(editor: vscode.TextEditor, item: TodoItem) {
    const document = editor.document;
    const today = getToday();

    function markLineComplete(lineText: string): string {
        let result = lineText;
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

    const parsed = parseDocument(document);
    const completedSection = parsed.sections.get('completed');

    const endLine = getItemWithDescendantsEndLine(document, item);
    const itemLines: string[] = [];

    for (let i = item.line; i <= endLine; i++) {
        const lineText = document.lineAt(i).text;
        if (/^\s*-\s*\[[ xX]\]/.test(lineText)) {
            itemLines.push(markLineComplete(lineText));
        } else {
            itemLines.push(lineText);
        }
    }

    // CASE 1: Nested todo (has parent) - update in place with children, don't move
    if (isNestedItem(item)) {
        await editor.edit((editBuilder: vscode.TextEditorEdit) => {
            const range = new vscode.Range(item.line, 0, endLine, document.lineAt(endLine).text.length);
            editBuilder.replace(range, itemLines.join('\n'));
        });
        vscode.window.showInformationMessage(`Completed: ${item.text}`);
        return;
    }

    // CASE 2: No Completed section - just update in place
    if (!completedSection) {
        await editor.edit((editBuilder: vscode.TextEditorEdit) => {
            const range = new vscode.Range(item.line, 0, endLine, document.lineAt(endLine).text.length);
            editBuilder.replace(range, itemLines.join('\n'));
        });
        vscode.window.showInformationMessage(`Completed: ${item.text}`);
        return;
    }

    // CASE 3: Already in Completed section - just update in place
    if (item.line >= completedSection.start && item.line <= completedSection.end) {
        await editor.edit((editBuilder: vscode.TextEditorEdit) => {
            const range = new vscode.Range(item.line, 0, endLine, document.lineAt(endLine).text.length);
            editBuilder.replace(range, itemLines.join('\n'));
        });
        vscode.window.showInformationMessage(`Completed: ${item.text}`);
        return;
    }

    // CASE 4: Top-level todo - move entire tree (with all children marked complete) to Completed
    const deleteStart = item.line;
    const deleteEnd = endLine + 1;

    await editor.edit((editBuilder: vscode.TextEditorEdit) => {
        const deleteRange = new vscode.Range(deleteStart, 0, deleteEnd, 0);
        editBuilder.delete(deleteRange);
    });

    const updatedDoc = editor.document;
    const updatedParsed = parseDocument(updatedDoc);
    const updatedCompletedSection = updatedParsed.sections.get('completed');

    if (!updatedCompletedSection) {
        vscode.window.showInformationMessage(`Completed: ${item.text}`);
        return;
    }

    const lineAfterHeader = updatedCompletedSection.start + 1;
    const hasBlankAfterHeader = lineAfterHeader < updatedDoc.lineCount &&
        updatedDoc.lineAt(lineAfterHeader).text.trim() === '';

    let insertText = itemLines.join('\n') + '\n';
    const insertLine = hasBlankAfterHeader
        ? updatedCompletedSection.start + 2
        : updatedCompletedSection.start + 1;

    if (!hasBlankAfterHeader) {
        insertText = '\n' + insertText;
    }

    await editor.edit((editBuilder: vscode.TextEditorEdit) => {
        editBuilder.insert(new vscode.Position(insertLine, 0), insertText);
    });

    vscode.window.showInformationMessage(`Completed: ${item.text}`);
}
