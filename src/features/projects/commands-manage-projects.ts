import * as vscode from 'vscode';
import { ProjectDefinition } from '../../core/model';
import { parseDocument } from '../../vscode/document-cache';
import { requireTodoEditor } from '../../vscode/guards';
import { PROJECT_NAME_RE } from '../../core/tokens';
import { addProjectDefinition } from '../../vscode/prompts';

export async function manageProjects(editor: vscode.TextEditor) {
    const ctx = requireTodoEditor(editor);
    if (!ctx) {
        return;
    }
    const effectiveEditor = ctx.editor;
    const effectiveDocument = ctx.document;

    const parsed = parseDocument(effectiveDocument);

    interface ActionItem extends vscode.QuickPickItem {
        action: string;
        projectDef?: ProjectDefinition;
    }

    const picks: ActionItem[] = [
        { label: '$(add) Add new project', action: 'add' },
        { label: '', kind: vscode.QuickPickItemKind.Separator, action: '' },
        ...[...parsed.projectDefinitions]
            .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
            .map((p) => ({
                label: p.name,
                description: p.description,
                action: 'edit',
                projectDef: p,
            })),
    ];

    const selected = await vscode.window.showQuickPick(picks, {
        placeHolder: 'Manage project definitions',
    });

    if (!selected?.action) {
        return;
    }

    if (selected.action === 'add') {
        const name = await vscode.window.showInputBox({
            prompt: 'Project name (alphanumeric and hyphens)',
            validateInput: (value) => {
                if (!PROJECT_NAME_RE.test(value)) {
                    return 'Project name must be alphanumeric (hyphens allowed)';
                }
                if (parsed.projectDefinitions.some((p) => p.name === value)) {
                    return 'Project already exists';
                }
                return null;
            },
        });
        if (!name) {
            return;
        }

        const desc = await vscode.window.showInputBox({
            prompt: 'Project description',
        });
        if (!desc) {
            return;
        }

        await addProjectDefinition(effectiveEditor, name, desc);
    } else if (selected.action === 'edit' && selected.projectDef) {
        const newDesc = await vscode.window.showInputBox({
            prompt: `Edit description for [${selected.projectDef.name}]`,
            value: selected.projectDef.description,
        });
        if (newDesc === undefined) {
            return;
        }

        const line = effectiveDocument.lineAt(selected.projectDef.line);
        const newText = `**${selected.projectDef.name}**: ${newDesc}`;

        await effectiveEditor.edit((editBuilder: vscode.TextEditorEdit) => {
            editBuilder.replace(line.range, newText);
        });

        vscode.window.showInformationMessage(`Updated [${selected.projectDef.name}]`);
    }
}
