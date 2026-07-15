/**
 * Phase 5 feature tests: the auto-date Enter handler — stamping newly typed
 * todo and note lines with `+YYYY-MM-DD` (LOCAL date, fixed clock), the
 * F-16 checkbox normalization on the rewrite, and every no-stamp guard
 * (existing date, empty text, non-todo file, inactive document, no newline).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { registerAutoDateHandler } from '../../src/features/auto-date/auto-date';
import { clearParseCache } from '../../src/vscode/document-cache';
import { makeEditableEditor, EditableEditor } from './harness';

interface ChangeEvent {
    document: vscode.TextDocument;
    contentChanges: {
        text: string;
        range: vscode.Range;
        rangeLength: number;
    }[];
}

let handler: ((event: ChangeEvent) => Promise<void>) | undefined;

const win = vscode.window as unknown as { activeTextEditor: vscode.TextEditor | undefined };
const ws = vscode.workspace as unknown as {
    onDidChangeTextDocument(h: (event: ChangeEvent) => Promise<void>): { dispose(): void };
};

beforeEach(() => {
    clearParseCache();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 6, 15, 22, 30, 0));
    handler = undefined;
    ws.onDidChangeTextDocument = (h) => {
        handler = h;
        return { dispose: () => undefined };
    };
    registerAutoDateHandler({ subscriptions: [] } as unknown as vscode.ExtensionContext);
    win.activeTextEditor = undefined;
});

afterEach(() => {
    vi.useRealTimers();
});

const HEADER = ['---', 'md-todo: true', '---', '', '## Active', ''];

/**
 * Simulate the document state AFTER the user pressed Enter at the end of
 * `lineNo` and fire the change event the way VS Code reports it: one change
 * whose text contains the newline, anchored at the split point.
 */
async function pressEnterAfter(ed: EditableEditor, lineNo: number): Promise<void> {
    const lineLen = ed.lines()[lineNo].length;
    await ed.editor.edit((b) => {
        b.insert(new vscode.Position(lineNo, lineLen), '\n');
    });
    win.activeTextEditor = ed.editor;
    await handler!({
        document: ed.document,
        contentChanges: [
            {
                text: '\n',
                range: new vscode.Range(lineNo, lineLen, lineNo, lineLen),
                rangeLength: 0,
            },
        ],
    });
}

describe('auto-date on Enter', () => {
    it('stamps a newly typed todo line with the LOCAL date', async () => {
        const ed = makeEditableEditor([...HEADER, '- [ ] New task'].join('\n'));
        await pressEnterAfter(ed, 6);
        expect(ed.lines()[6]).toBe('- [ ] New task `+2026-07-15`');
    });

    it('normalizes a mixed-case [X] checkbox while stamping (F-16)', async () => {
        const ed = makeEditableEditor([...HEADER, '- [X] Already done'].join('\n'));
        await pressEnterAfter(ed, 6);
        expect(ed.lines()[6]).toBe('- [x] Already done `+2026-07-15`');
    });

    it('stamps a newly typed note line, preserving its indent', async () => {
        const ed = makeEditableEditor(
            [...HEADER, '- [ ] Task `+2026-07-01`', '  - progress note'].join('\n')
        );
        await pressEnterAfter(ed, 7);
        expect(ed.lines()[7]).toBe('  - progress note `+2026-07-15`');
    });

    it('does NOT stamp a line that already carries a date', async () => {
        const line = '- [ ] Dated task `+2026-07-01`';
        const ed = makeEditableEditor([...HEADER, line].join('\n'));
        await pressEnterAfter(ed, 6);
        expect(ed.lines()[6]).toBe(line);
    });

    it('does NOT stamp a note that already carries a date', async () => {
        const ed = makeEditableEditor(
            [...HEADER, '- [ ] Task', '  - note `+2026-07-02`'].join('\n')
        );
        await pressEnterAfter(ed, 7);
        expect(ed.lines()[7]).toBe('  - note `+2026-07-02`');
    });

    it('does NOT stamp an empty checkbox line', async () => {
        const ed = makeEditableEditor([...HEADER, '- [ ] '].join('\n'));
        await pressEnterAfter(ed, 6);
        expect(ed.lines()[6]).toBe('- [ ] ');
    });

    it('does NOT stamp in a non-todo file', async () => {
        const ed = makeEditableEditor('# plain markdown\n- [ ] not opted in');
        await pressEnterAfter(ed, 1);
        expect(ed.lines()[1]).toBe('- [ ] not opted in');
    });

    it('ignores changes to documents other than the active editor', async () => {
        const ed = makeEditableEditor([...HEADER, '- [ ] New task'].join('\n'));
        const other = makeEditableEditor([...HEADER, '- [ ] other'].join('\n'));
        win.activeTextEditor = other.editor;
        await handler!({
            document: ed.document,
            contentChanges: [{ text: '\n', range: new vscode.Range(6, 14, 6, 14), rangeLength: 0 }],
        });
        expect(ed.lines()[6]).toBe('- [ ] New task');
    });

    it('ignores changes that do not contain a newline', async () => {
        const ed = makeEditableEditor([...HEADER, '- [ ] New task'].join('\n'));
        win.activeTextEditor = ed.editor;
        await handler!({
            document: ed.document,
            contentChanges: [{ text: 'x', range: new vscode.Range(6, 14, 6, 14), rangeLength: 0 }],
        });
        expect(ed.lines()[6]).toBe('- [ ] New task');
    });
});
