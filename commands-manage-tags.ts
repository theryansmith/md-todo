import * as vscode from 'vscode';
import { TagDefinition } from './types';
import { isTodoFile, parseDocument, getEffectiveEditor } from './parser';
import { addTagDefinition } from './prompts';

export async function manageTags(editor: vscode.TextEditor) {
    const ctx = await getEffectiveEditor(editor);
    const effectiveEditor = ctx.editor;
    const effectiveDocument = ctx.document;

    if (!isTodoFile(effectiveDocument)) {
        vscode.window.showWarningMessage('Not a todo file. Add "md-todo: true" to YAML frontmatter.');
        return;
    }

    const parsed = parseDocument(effectiveDocument);

    interface ActionItem extends vscode.QuickPickItem {
        action: string;
        tagDef?: TagDefinition;
    }

    const picks: ActionItem[] = [
        { label: '$(add) Add new tag', action: 'add' },
        { label: '', kind: vscode.QuickPickItemKind.Separator, action: '' },
        ...[...parsed.tagDefinitions]
            .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
            .map(t => ({
                label: t.name,
                description: t.description,
                action: 'edit',
                tagDef: t
            }))
    ];

    const selected = await vscode.window.showQuickPick(picks, {
        placeHolder: 'Manage tag definitions'
    });

    if (!selected || !selected.action) { return; }

    if (selected.action === 'add') {
        const name = await vscode.window.showInputBox({
            prompt: 'Tag name (alphanumeric and hyphens)',
            validateInput: (value) => {
                if (!value.match(/^[\w-]+$/)) {
                    return 'Tag name must be alphanumeric (hyphens allowed)';
                }
                if (parsed.tagDefinitions.some(t => t.name === value)) {
                    return 'Tag already exists';
                }
                return null;
            }
        });
        if (!name) { return; }

        const desc = await vscode.window.showInputBox({
            prompt: 'Tag description'
        });
        if (!desc) { return; }

        await addTagDefinition(effectiveEditor, name, desc);
    } else if (selected.action === 'edit' && selected.tagDef) {
        const newDesc = await vscode.window.showInputBox({
            prompt: `Edit description for #${selected.tagDef.name}`,
            value: selected.tagDef.description
        });
        if (newDesc === undefined) { return; }

        const line = effectiveDocument.lineAt(selected.tagDef.line);
        const newText = `**${selected.tagDef.name}**: ${newDesc}`;

        await effectiveEditor.edit((editBuilder: vscode.TextEditorEdit) => {
            editBuilder.replace(line.range, newText);
        });

        vscode.window.showInformationMessage(`Updated #${selected.tagDef.name}`);
    }
}
