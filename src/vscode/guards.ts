import * as vscode from 'vscode';
import { isTodoFile } from './document-cache';

/**
 * The one todo-file guard (F-09/F-10). Every command that requires an opted-in
 * todo document calls this instead of hand-rolling the isTodoFile check:
 * when the editor is missing or its document is not a todo file, the
 * canonical warning is shown and `undefined` is returned so the caller can
 * simply bail out.
 */
export function requireTodoEditor(
    editor: vscode.TextEditor | undefined
): { editor: vscode.TextEditor; document: vscode.TextDocument } | undefined {
    if (!editor || !isTodoFile(editor.document)) {
        vscode.window.showWarningMessage(
            'Not a todo file. Add "md-todo: true" to YAML frontmatter.'
        );
        return undefined;
    }
    return { editor, document: editor.document };
}
