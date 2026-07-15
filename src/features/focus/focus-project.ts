import * as vscode from 'vscode';
import { isTodoFile, parseDocument } from '../../vscode/document-cache';
import { requireTodoEditor } from '../../vscode/guards';
import { getFocusProject, setFocusProjectState } from '../../vscode/state';
import { dimDecoration } from './decoration-dim';

export async function clearFocusProject(): Promise<void> {
    await setFocusProjectState(undefined);
    for (const visible of vscode.window.visibleTextEditors) {
        if (isTodoFile(visible.document)) {
            dimDecoration.update(visible);
        }
    }
    refreshFocusProjectStatusBar(vscode.window.activeTextEditor);
}

let projectFocusStatusBarItem: vscode.StatusBarItem | undefined;

export function initFocusProjectStatusBar(context: vscode.ExtensionContext): void {
    // Project-focus status bar (priority 97 so tag-focus at 99 and user-focus
    // at 100 sit to its right, activity at 98 directly beside it).
    projectFocusStatusBarItem = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Right,
        97
    );
    projectFocusStatusBarItem.command = 'mdTodo.setFocusProject';
    context.subscriptions.push(projectFocusStatusBarItem);
}

export function refreshFocusProjectStatusBar(editor: vscode.TextEditor | undefined) {
    if (!projectFocusStatusBarItem) {
        return;
    }
    if (!editor || !isTodoFile(editor.document)) {
        projectFocusStatusBarItem.hide();
        return;
    }
    const focus = getFocusProject();
    if (!focus) {
        projectFocusStatusBarItem.text = '$(project) All projects';
        projectFocusStatusBarItem.tooltip = 'No project focus — click to focus on a project';
    } else {
        projectFocusStatusBarItem.text = `$(project) [${focus}]`;
        projectFocusStatusBarItem.tooltip = `Focused on [${focus}] — click to change`;
    }
    projectFocusStatusBarItem.show();
}

export async function setFocusProject(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage('Open a todo file first');
        return;
    }
    const ctx = requireTodoEditor(editor);
    if (!ctx) {
        return;
    }
    const parsed = parseDocument(ctx.document);

    type ProjectPick = vscode.QuickPickItem & { projectName: string | undefined };
    const picks: ProjectPick[] = [
        {
            label: '$(circle-slash) Clear focus',
            description: 'Show all projects',
            projectName: undefined,
        },
        ...[...parsed.projectDefinitions]
            .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
            .map<ProjectPick>((p) => ({
                label: `$(project) ${p.name}`,
                detail: p.description,
                projectName: p.name,
            })),
    ];

    if (parsed.projectDefinitions.length === 0) {
        vscode.window.showInformationMessage(
            'No projects defined. Add a "## Projects" section first.'
        );
    }

    const current = getFocusProject();
    const placeHolder = current
        ? `Currently focused on [${current}]`
        : 'Select a project to focus on (or clear)';
    const picked = await vscode.window.showQuickPick(picks, {
        placeHolder,
        matchOnDescription: true,
        matchOnDetail: true,
    });
    if (!picked) {
        return;
    }

    await setFocusProjectState(picked.projectName);
    for (const visible of vscode.window.visibleTextEditors) {
        if (isTodoFile(visible.document)) {
            dimDecoration.update(visible);
        }
    }
    refreshFocusProjectStatusBar(vscode.window.activeTextEditor);
}
