/**
 * Phase 5 feature tests: the Add Note command — note indent derivation
 * (item.indent + 2), insertion point after the item's WHOLE block (notes and
 * nested todos included), the no-cursor QuickPick fallback, and the
 * cancel/no-items paths. Clock fixed at 2026-07-15 so the `+date` stamp is
 * deterministic.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { addNote } from '../../src/features/items/commands-add-note';
import { clearParseCache } from '../../src/vscode/document-cache';
import {
    makeEditableEditor,
    installFakeQuickPick,
    FakeQuickPick,
    flush,
    EditableEditor,
} from './harness';

const FIXTURE = [
    '---',
    'md-todo: true',
    '---',
    '',
    '## Active',
    '',
    '- [ ] Parent task',
    '  - existing note',
    '  - [ ] Nested child',
    '- [ ] Second task',
    '', // trailing newline, like any POSIX text file
].join('\n');

interface Msgs {
    infos: string[];
    warnings: string[];
}

const win = vscode.window as unknown as {
    showInformationMessage(msg: string): Thenable<undefined>;
    showWarningMessage(msg: string): Thenable<undefined>;
    showQuickPick(
        items: readonly vscode.QuickPickItem[],
        options?: unknown
    ): Thenable<vscode.QuickPickItem | undefined>;
};

let msgs: Msgs;
let created: FakeQuickPick<vscode.QuickPickItem>[];
let quickPickItems: vscode.QuickPickItem[][];
let quickPickResponder: (
    items: readonly vscode.QuickPickItem[]
) => vscode.QuickPickItem | undefined;

beforeEach(() => {
    clearParseCache();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 6, 15, 12, 0, 0));
    msgs = { infos: [], warnings: [] };
    created = installFakeQuickPick();
    quickPickItems = [];
    quickPickResponder = () => undefined;
    win.showInformationMessage = (msg) => {
        msgs.infos.push(msg);
        return Promise.resolve(undefined);
    };
    win.showWarningMessage = (msg) => {
        msgs.warnings.push(msg);
        return Promise.resolve(undefined);
    };
    win.showQuickPick = (items) => {
        quickPickItems.push([...items]);
        return Promise.resolve(quickPickResponder(items));
    };
});

afterEach(() => {
    vi.useRealTimers();
});

/** Drive addNote to completion, answering the note prompt with `note`. */
async function runAddNote(ed: EditableEditor, note: string | undefined): Promise<void> {
    const done = addNote(ed.editor);
    await flush(); // let the item QuickPick (if any) resolve first
    const qp = created[created.length - 1];
    if (note === undefined) {
        qp.hide();
    } else {
        qp.type(note);
        qp.accept();
    }
    await done;
}

describe('addNote — cursor on an item', () => {
    it('inserts the note at item.indent + 2 AFTER the whole block (nested todos included), date-stamped', async () => {
        const ed = makeEditableEditor(FIXTURE);
        ed.setCursor(6, 3); // on "Parent task"
        await runAddNote(ed, 'Talked to the team');
        expect(ed.lines().slice(6, 11)).toEqual([
            '- [ ] Parent task',
            '  - existing note',
            '  - [ ] Nested child',
            '  - Talked to the team `+2026-07-15`',
            '- [ ] Second task',
        ]);
        expect(msgs.infos).toContain('Note added');
    });

    it('a note for a NESTED item is indented relative to that item (indent + 2)', async () => {
        const ed = makeEditableEditor(FIXTURE);
        ed.setCursor(8, 5); // on "Nested child" (indent 2)
        await runAddNote(ed, 'child progress');
        expect(ed.lines().slice(8, 11)).toEqual([
            '  - [ ] Nested child',
            '    - child progress `+2026-07-15`',
            '- [ ] Second task',
        ]);
    });

    it('resolves the item by walking UP from a note line under it', async () => {
        const ed = makeEditableEditor(FIXTURE);
        ed.setCursor(7, 4); // on "existing note"
        await runAddNote(ed, 'another note');
        // Still attaches to Parent task — inserted after the whole block.
        expect(ed.lines()[9]).toBe('  - another note `+2026-07-15`');
    });

    it('cancelling the note prompt changes nothing', async () => {
        const ed = makeEditableEditor(FIXTURE);
        ed.setCursor(6, 3);
        await runAddNote(ed, undefined);
        expect(ed.text()).toBe(FIXTURE);
        expect(msgs.infos).not.toContain('Note added');
    });
});

describe('addNote — no item at the cursor', () => {
    it('offers a QuickPick of all top-level items and adds the note to the selection', async () => {
        const ed = makeEditableEditor(FIXTURE);
        ed.setCursor(5, 0); // blank line under the section header
        quickPickResponder = (items) => items.find((i) => i.label === '○ Second task');
        await runAddNote(ed, 'picked note');
        expect(quickPickItems[0].map((i) => i.label)).toEqual(['○ Parent task', '○ Second task']);
        expect(ed.lines().slice(9, 11)).toEqual([
            '- [ ] Second task',
            '  - picked note `+2026-07-15`',
        ]);
    });

    it('shows the note count as the pick description', async () => {
        const ed = makeEditableEditor(FIXTURE);
        ed.setCursor(5, 0);
        quickPickResponder = (items) => items[0];
        await runAddNote(ed, 'x');
        expect(quickPickItems[0].map((i) => i.description)).toEqual(['1 notes', '']);
    });

    it('cancelling the item pick changes nothing', async () => {
        const ed = makeEditableEditor(FIXTURE);
        ed.setCursor(5, 0);
        quickPickResponder = () => undefined;
        const done = addNote(ed.editor);
        await flush();
        await done;
        expect(ed.text()).toBe(FIXTURE);
    });

    it('reports when the document has no todo items at all', async () => {
        const ed = makeEditableEditor(['---', 'md-todo: true', '---', '', '## Active'].join('\n'));
        ed.setCursor(4, 0);
        await addNote(ed.editor);
        expect(msgs.infos).toContain('No todo items found');
    });
});

describe('addNote — guard', () => {
    it('warns and bails on a non-todo file', async () => {
        const ed = makeEditableEditor('# Just markdown\n\n- [ ] not opted in');
        await addNote(ed.editor);
        expect(msgs.warnings).toContain(
            'Not a todo file. Add "md-todo: true" to YAML frontmatter.'
        );
        expect(ed.text()).toBe('# Just markdown\n\n- [ ] not opted in');
    });
});
