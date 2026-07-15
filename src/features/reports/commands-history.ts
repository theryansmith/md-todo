import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';
import { requireTodoEditor } from '../../vscode/guards';

const execAsync = promisify(exec);

export async function showHistory(editor: vscode.TextEditor) {
    const ctx = requireTodoEditor(editor);
    if (!ctx) {
        return;
    }
    const effectiveDocument = ctx.document;

    const workspaceFolder = vscode.workspace.getWorkspaceFolder(effectiveDocument.uri);
    if (!workspaceFolder) {
        vscode.window.showErrorMessage('Not in a workspace');
        return;
    }

    const filePath = effectiveDocument.uri.fsPath;
    const cwd = workspaceFolder.uri.fsPath;

    try {
        const { stdout } = await execAsync(`git log --oneline --follow -20 -- "${filePath}"`, {
            cwd,
        });

        if (!stdout.trim()) {
            vscode.window.showInformationMessage('No git history found for this file');
            return;
        }

        interface Commit {
            hash: string;
            message: string;
        }

        const commits: Commit[] = stdout
            .trim()
            .split('\n')
            .map((line: string) => {
                const [hash, ...messageParts] = line.split(' ');
                return { hash, message: messageParts.join(' ') };
            });

        const picks = commits.map((c) => ({
            label: c.hash,
            description: c.message,
            commit: c,
        }));

        const selected = await vscode.window.showQuickPick(picks, {
            placeHolder: 'Select commit to view diff',
        });

        if (!selected) {
            return;
        }

        const { stdout: diff } = await execAsync(
            `git show ${selected.commit.hash} --format="" -- "${filePath}"`,
            { cwd }
        );

        const doc = await vscode.workspace.openTextDocument({
            content: `# Changes in ${selected.commit.hash}\n${selected.commit.message}\n\n${diff}`,
            language: 'diff',
        });

        await vscode.window.showTextDocument(doc, { preview: true });
    } catch (error) {
        vscode.window.showErrorMessage(
            `Git error: ${error instanceof Error ? error.message : String(error)}`
        );
    }
}
