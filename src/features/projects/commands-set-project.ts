import * as vscode from 'vscode';
import { isTodoFile, parseDocument, findItemAtCursor, getEffectiveEditor } from '../../core/parser';
import { PROJECT_TOKEN_RE_G, PROJECT_NAME_RE, formatProjectToken } from '../../core/tokens';
import { addProjectDefinition } from '../../vscode/prompts';

/**
 * Pure line transform: strip every project token, trim trailing whitespace,
 * then append exactly one canonical token at the end of the line (or none,
 * when the project is being removed).
 */
export function computeProjectLine(lineText: string, projectName: string | undefined): string {
    let newText = lineText.replace(PROJECT_TOKEN_RE_G, '').replace(/\s+$/, '');
    if (projectName) {
        newText = newText + ' ' + formatProjectToken(projectName);
    }
    return newText;
}

export async function setProject(editor: vscode.TextEditor) {
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
            description: item.project ? `[${item.project}]` : '',
            item,
        }));

        const selected = await vscode.window.showQuickPick(picks, {
            placeHolder: 'Select item to set project on',
        });

        if (!selected) {
            return;
        }
        result = { item: selected.item, lineNum: selected.item.line };
    }

    const parsed = parseDocument(effectiveDocument);

    interface ProjectPick extends vscode.QuickPickItem {
        action: 'none' | 'create' | 'set';
        projectName?: string;
    }

    const picks: ProjectPick[] = [
        {
            label: '$(circle-slash) No project',
            description: 'Remove the project from this item',
            action: 'none',
        },
        { label: '$(add) Create new project…', action: 'create' },
        ...parsed.projectDefinitions.map<ProjectPick>((p) => ({
            label: p.name,
            description: p.description,
            action: 'set',
            projectName: p.name,
        })),
    ];

    const current = result.item.project;
    const selected = await vscode.window.showQuickPick(picks, {
        placeHolder: current
            ? `Current project: [${current}] — select a project for this item`
            : 'Select a project for this item',
    });

    if (!selected) {
        return;
    }

    let chosen: string | undefined;
    if (selected.action === 'none') {
        chosen = undefined;
    } else if (selected.action === 'create') {
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
        chosen = name;
    } else {
        chosen = selected.projectName;
    }

    // Read the line from the current document state — the create-new path may
    // have just edited the document (definitions live below the todo sections,
    // so the item's line number is unaffected in the canonical layout).
    const line = effectiveEditor.document.lineAt(result.item.line);

    await effectiveEditor.edit((editBuilder: vscode.TextEditorEdit) => {
        editBuilder.replace(line.range, computeProjectLine(line.text, chosen));
    });

    vscode.window.showInformationMessage(chosen ? `Project set: [${chosen}]` : 'Project removed');
}
