import * as vscode from 'vscode';
import { TodoItem } from './types';
import { isTodoFile, parseDocument, findItemAtCursor, getEffectiveEditor } from './parser';
import { processTagsWithValidation } from './prompts';

export async function addTags(editor: vscode.TextEditor) {
    const ctx = await getEffectiveEditor(editor);
    const effectiveEditor = ctx.editor;
    const effectiveDocument = ctx.document;

    if (!isTodoFile(effectiveDocument)) {
        vscode.window.showWarningMessage(
            'Not a todo file. Add "md-todo: true" to YAML frontmatter.'
        );
        return;
    }

    let result = findItemAtCursor(effectiveEditor);

    if (!result) {
        const parsed = parseDocument(effectiveDocument);

        if (parsed.items.length === 0) {
            vscode.window.showInformationMessage('No todo items found');
            return;
        }

        const picks = parsed.items.map((item) => ({
            label: `${item.isComplete ? '✓' : '○'} ${item.text}`,
            description: item.tags.length > 0 ? item.tags.map((t) => `#${t}`).join(' ') : '',
            item,
        }));

        const selected = await vscode.window.showQuickPick(picks, {
            placeHolder: 'Select item to tag',
        });

        if (!selected) {
            return;
        }
        result = { item: selected.item, lineNum: selected.item.line };
    }

    const parsed = parseDocument(effectiveDocument);

    const existingTags = result.item.tags;
    const picks = [...parsed.tagDefinitions]
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
        .map((tag) => ({
            label: tag.name,
            description: tag.description,
            picked: existingTags.includes(tag.name),
        }));

    const selected = await vscode.window.showQuickPick(picks, {
        canPickMany: true,
        placeHolder: 'Select tags for this item',
    });

    if (!selected) {
        return;
    }
    const selectedTags = selected.map((s) => s.label);

    const finalTags = await processTagsWithValidation(effectiveEditor, selectedTags);
    if (finalTags === null) {
        return;
    }

    await updateItemTags(effectiveEditor, result.item, finalTags);
}

/**
 * Pure line transform: strip every #tag, trim trailing whitespace, then
 * append the new tag set at the end of the line (or nothing, when empty).
 */
export function computeTagsLine(lineText: string, tags: string[]): string {
    let newText = lineText.replace(/#[\w-]+/g, '').replace(/\s+$/, '');

    if (tags.length > 0) {
        const tagString = tags.map((t) => `#${t}`).join(' ');
        newText = newText + ' ' + tagString;
    }

    return newText;
}

async function updateItemTags(editor: vscode.TextEditor, item: TodoItem, newTags: string[]) {
    const document = editor.document;
    const line = document.lineAt(item.line);
    const newText = computeTagsLine(line.text, newTags);

    await editor.edit((editBuilder: vscode.TextEditorEdit) => {
        editBuilder.replace(line.range, newText);
    });

    vscode.window.showInformationMessage(
        `Tags updated: ${newTags.length > 0 ? newTags.map((t) => `#${t}`).join(' ') : '(none)'}`
    );
}
