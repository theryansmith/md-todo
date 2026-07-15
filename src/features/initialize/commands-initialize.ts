import * as vscode from 'vscode';
import { isTodoFile } from '../../core/parser';

export async function initializeTodoFile(editor: vscode.TextEditor) {
    const document = editor.document;

    if (document.languageId !== 'markdown') {
        vscode.window.showWarningMessage('Initialize only works on markdown files');
        return;
    }

    if (isTodoFile(document)) {
        vscode.window.showInformationMessage('File is already a todo file');
        return;
    }

    const template = `---
md-todo: true
---

# TODO

## Active

## Completed

## Archive

<!-- Completed items older than 7 days get moved here -->

## Tags

## Projects

`;

    if (document.getText().trim() === '') {
        await editor.edit((editBuilder) => {
            editBuilder.insert(new vscode.Position(0, 0), template);
        });
        vscode.window.showInformationMessage('Todo file initialized');
    } else {
        const choice = await vscode.window.showQuickPick(
            ['Prepend frontmatter only', 'Replace entire file', 'Cancel'],
            { placeHolder: 'File has existing content. How to initialize?' }
        );

        if (choice === 'Prepend frontmatter only') {
            await editor.edit((editBuilder) => {
                editBuilder.insert(new vscode.Position(0, 0), '---\nmd-todo: true\n---\n\n');
            });
            vscode.window.showInformationMessage('Todo frontmatter added');
        } else if (choice === 'Replace entire file') {
            const confirm = await vscode.window.showWarningMessage(
                'This will replace all content. Continue?',
                { modal: true },
                'Yes'
            );

            if (confirm === 'Yes') {
                const fullRange = new vscode.Range(
                    new vscode.Position(0, 0),
                    new vscode.Position(document.lineCount, 0)
                );
                await editor.edit((editBuilder) => {
                    editBuilder.replace(fullRange, template);
                });
                vscode.window.showInformationMessage('Todo file initialized');
            }
        }
    }
}
