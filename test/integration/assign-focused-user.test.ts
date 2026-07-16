/**
 * Phase 5 feature tests: the Assign Focused User toggle — insertion with
 * surrounding-whitespace preservation, whole-word removal (including the
 * trailing-token edge from IMPROVEMENTS Robust-9: no trailing whitespace is
 * left behind), the focused vs QuickPick user sources, and the guards.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import * as vscode from 'vscode';
import { assignFocusedUser } from '../../src/features/users/commands-assign-focused-user';
import { userFocus } from '../../src/features/focus/focus-user';
import { setExtensionContext } from '../../src/vscode/workspace-state';
import { clearParseCache } from '../../src/vscode/document-cache';
import { makeEditableEditor } from './harness';

const FIXTURE = [
    '---',
    'md-todo: true',
    '---',
    '',
    '## Active',
    '',
    '- [ ] Fix login @alice #auth',
    '- [ ] No mentions yet',
    '- [ ] Trailing token @alice',
    '- [ ] Contains @alice-b only',
    '  - [ ] Sub @alice thing',
    'not a todo line',
    '',
    '## Users',
    '',
    '**bob** (Bob Jones): backend',
    '**alice** (Alice Smith): frontend',
    '',
].join('\n');

const win = vscode.window as unknown as {
    showWarningMessage(msg: string): Thenable<undefined>;
    showInformationMessage(msg: string): Thenable<undefined>;
    showQuickPick(
        items: readonly vscode.QuickPickItem[],
        options?: { placeHolder?: string; matchOnDescription?: boolean; matchOnDetail?: boolean }
    ): Thenable<vscode.QuickPickItem | undefined>;
};

let warnings: string[];
let infos: string[];
let quickPicks: { items: vscode.QuickPickItem[]; options: unknown }[];
let quickPickResponder: (
    items: readonly vscode.QuickPickItem[]
) => vscode.QuickPickItem | undefined;

function makeContext(): vscode.ExtensionContext {
    const store = new Map<string, unknown>();
    return {
        subscriptions: [],
        workspaceState: {
            get: (key: string) => store.get(key),
            update: (key: string, value: unknown) => {
                if (value === undefined) {
                    store.delete(key);
                } else {
                    store.set(key, value);
                }
                return Promise.resolve();
            },
        },
    } as unknown as vscode.ExtensionContext;
}

beforeEach(async () => {
    clearParseCache();
    warnings = [];
    infos = [];
    quickPicks = [];
    quickPickResponder = () => undefined;
    win.showWarningMessage = (msg) => {
        warnings.push(msg);
        return Promise.resolve(undefined);
    };
    win.showInformationMessage = (msg) => {
        infos.push(msg);
        return Promise.resolve(undefined);
    };
    win.showQuickPick = (items, options) => {
        quickPicks.push({ items: [...items], options });
        return Promise.resolve(quickPickResponder(items));
    };
    (vscode.window as unknown as { visibleTextEditors: unknown[] }).visibleTextEditors = [];
    setExtensionContext(makeContext());
    await userFocus.setState(undefined);
});

describe('assignFocusedUser — REMOVE when the line already mentions the user', () => {
    beforeEach(() => userFocus.setState('alice'));

    it('removes a mid-line mention and collapses the doubled space', async () => {
        const ed = makeEditableEditor(FIXTURE);
        ed.setCursor(6, 0);
        await assignFocusedUser(ed.editor);
        expect(ed.lines()[6]).toBe('- [ ] Fix login #auth');
    });

    it('removes a TRAILING mention without leaving trailing whitespace (Robust-9)', async () => {
        const ed = makeEditableEditor(FIXTURE);
        ed.setCursor(8, 0);
        await assignFocusedUser(ed.editor);
        expect(ed.lines()[8]).toBe('- [ ] Trailing token');
    });

    it('preserves the leading indent of a nested todo on removal', async () => {
        const ed = makeEditableEditor(FIXTURE);
        ed.setCursor(10, 0);
        await assignFocusedUser(ed.editor);
        expect(ed.lines()[10]).toBe('  - [ ] Sub thing');
    });

    it('matches whole words only: @alice-b does NOT count as @alice', async () => {
        const ed = makeEditableEditor(FIXTURE);
        const line = '- [ ] Contains @alice-b only';
        ed.setCursor(9, line.length);
        await assignFocusedUser(ed.editor);
        // Not a removal — @alice is INSERTED at the cursor instead.
        expect(ed.lines()[9]).toBe('- [ ] Contains @alice-b only @alice');
    });
});

describe('assignFocusedUser — INSERT with whitespace preservation', () => {
    beforeEach(() => userFocus.setState('alice'));

    it('appends " @alice" at the end of the line (space added before, none after)', async () => {
        const ed = makeEditableEditor(FIXTURE);
        ed.setCursor(7, '- [ ] No mentions yet'.length);
        await assignFocusedUser(ed.editor);
        expect(ed.lines()[7]).toBe('- [ ] No mentions yet @alice');
    });

    it('inserts mid-line before a word with a trailing space, no doubled leading space', async () => {
        const ed = makeEditableEditor(FIXTURE);
        ed.setCursor(7, 9); // "- [ ] No |mentions yet" — after a space, before 'm'
        await assignFocusedUser(ed.editor);
        expect(ed.lines()[7]).toBe('- [ ] No @alice mentions yet');
    });

    it('inserts mid-word with spaces on BOTH sides', async () => {
        const ed = makeEditableEditor(FIXTURE);
        ed.setCursor(7, 11); // "- [ ] No me|ntions yet"
        await assignFocusedUser(ed.editor);
        expect(ed.lines()[7]).toBe('- [ ] No me @alice ntions yet');
    });

    it('clamps a cursor beyond the end of the line to the line end', async () => {
        const ed = makeEditableEditor(FIXTURE);
        ed.setCursor(7, 999);
        await assignFocusedUser(ed.editor);
        expect(ed.lines()[7]).toBe('- [ ] No mentions yet @alice');
    });
});

describe('assignFocusedUser — user source', () => {
    it('with no focus set, offers a QuickPick sorted by shortname and inserts the pick', async () => {
        const ed = makeEditableEditor(FIXTURE);
        ed.setCursor(7, '- [ ] No mentions yet'.length);
        quickPickResponder = (items) => items.find((i) => i.label === '$(person) @bob');
        await assignFocusedUser(ed.editor);
        expect(quickPicks[0].items.map((i) => i.label)).toEqual([
            '$(person) @alice',
            '$(person) @bob',
        ]);
        expect(quickPicks[0].items.map((i) => i.description)).toEqual(['Alice Smith', 'Bob Jones']);
        expect(quickPicks[0].options).toEqual({
            placeHolder: 'Select user to assign',
            matchOnDescription: true,
            matchOnDetail: true,
        });
        expect(ed.lines()[7]).toBe('- [ ] No mentions yet @bob');
    });

    it('cancelling the pick changes nothing', async () => {
        const ed = makeEditableEditor(FIXTURE);
        ed.setCursor(7, 0);
        quickPickResponder = () => undefined;
        await assignFocusedUser(ed.editor);
        expect(ed.text()).toBe(FIXTURE);
    });

    it('with no users defined, points at the missing "## Users" section', async () => {
        const noUsers = ['---', 'md-todo: true', '---', '', '- [ ] Lone item', ''].join('\n');
        const ed = makeEditableEditor(noUsers);
        ed.setCursor(4, 0);
        await assignFocusedUser(ed.editor);
        expect(infos).toContain('No users defined. Add a "## Users" section first.');
        expect(ed.text()).toBe(noUsers);
    });
});

describe('assignFocusedUser — guards', () => {
    it('warns when the cursor is not on a todo line', async () => {
        await userFocus.setState('alice');
        const ed = makeEditableEditor(FIXTURE);
        ed.setCursor(11, 0); // "not a todo line"
        await assignFocusedUser(ed.editor);
        expect(warnings).toContain('Place cursor on a todo line.');
        expect(ed.text()).toBe(FIXTURE);
    });

    it('warns on a non-todo file', async () => {
        const ed = makeEditableEditor('# not opted in\n- [ ] item');
        await assignFocusedUser(ed.editor);
        expect(warnings).toContain('Not a todo file. Add "md-todo: true" to YAML frontmatter.');
    });
});
