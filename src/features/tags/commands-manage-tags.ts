import * as vscode from 'vscode';
import { TagDefinition } from '../../core/model';
import { parseDocument } from '../../vscode/document-cache';
import { requireTodoEditor } from '../../vscode/guards';
import { addTagDefinition } from '../../vscode/prompts';

export async function manageTags(editor: vscode.TextEditor) {
    const ctx = requireTodoEditor(editor);
    if (!ctx) {
        return;
    }
    const effectiveEditor = ctx.editor;
    const effectiveDocument = ctx.document;

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
            .map((t) => ({
                label: t.name,
                description: t.description,
                action: 'edit',
                tagDef: t,
            })),
    ];

    const selected = await vscode.window.showQuickPick(picks, {
        placeHolder: 'Manage tag definitions',
    });

    if (!selected?.action) {
        return;
    }

    if (selected.action === 'add') {
        const name = await vscode.window.showInputBox({
            prompt: 'Tag name (alphanumeric and hyphens)',
            validateInput: (value) => {
                if (!/^[\w-]+$/.exec(value)) {
                    return 'Tag name must be alphanumeric (hyphens allowed)';
                }
                if (parsed.tagDefinitions.some((t) => t.name === value)) {
                    return 'Tag already exists';
                }
                return null;
            },
        });
        if (!name) {
            return;
        }

        const desc = await vscode.window.showInputBox({
            prompt: 'Tag description',
        });
        if (!desc) {
            return;
        }

        await addTagDefinition(effectiveEditor, name, desc);
    } else if (selected.action === 'edit' && selected.tagDef) {
        const newDesc = await vscode.window.showInputBox({
            prompt: `Edit description for #${selected.tagDef.name}`,
            value: selected.tagDef.description,
        });
        if (newDesc === undefined) {
            return;
        }

        const line = effectiveDocument.lineAt(selected.tagDef.line);
        const newText = `**${selected.tagDef.name}**: ${newDesc}`;

        await effectiveEditor.edit((editBuilder: vscode.TextEditorEdit) => {
            editBuilder.replace(line.range, newText);
        });

        vscode.window.showInformationMessage(`Updated #${selected.tagDef.name}`);
    }
}
