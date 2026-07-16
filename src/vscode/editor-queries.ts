import * as vscode from 'vscode';
import { TodoItem } from '../core/model';
import { findItemByLine } from '../core/query/items';
import { parseDocument } from './document-cache';

/**
 * Walk upward from the cursor to the nearest todo line and resolve it in the
 * (cached) parse. Editor/cursor geometry is a host concern; the resolution
 * itself is the pure findItemByLine.
 */
export function findItemAtCursor(
    editor: vscode.TextEditor
): { item: TodoItem; lineNum: number } | null {
    const document = editor.document;
    const cursorLine = editor.selection.active.line;
    const parsed = parseDocument(document);

    for (let i = cursorLine; i >= 0; i--) {
        const line = document.lineAt(i);
        const match = /^(\s*)-\s*\[([ xX])\]\s*(.+)$/.exec(line.text);
        if (match) {
            const item = findItemByLine(parsed.items, i);
            if (item) {
                return { item, lineNum: i };
            }
        }
        if (line.text.startsWith('#') || (line.text.trim() === '' && i < cursorLine - 1)) {
            break;
        }
    }
    return null;
}
