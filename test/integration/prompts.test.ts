/**
 * Phase 5 feature tests: the QuickPick prompt helpers — sortedSuggestions
 * ordering (the v1.4.1 "random-looking suggestion order" fix contract) and
 * the promptForTodoText inline-suggestion flow.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import * as vscode from 'vscode';
import { sortedSuggestions, promptForTodoText, SuggestionItem } from '../../src/vscode/prompts';
import { clearParseCache } from '../../src/vscode/document-cache';
import { makeDoc } from '../helpers';
import { installFakeQuickPick, FakeQuickPick } from './harness';

const FIXTURE = [
    '---',
    'md-todo: true',
    '---',
    '',
    '## Active',
    '',
    '- [ ] Something',
    '',
    '## Users',
    '',
    '**zed**: ops person',
    '**alice** (Alice Smith): frontend dev',
    '**Bob-dev** (Bob Dev): backend dev',
    '',
    '## Tags',
    '',
    '**beta-2**: second tag',
    '**alpha**: first tag',
    '',
    '## Projects',
    '',
    '**webapp**: the web app',
    '**Tools**: internal tooling',
].join('\n');

beforeEach(() => {
    clearParseCache();
});

describe('sortedSuggestions', () => {
    interface Def {
        name: string;
        description: string;
    }
    const defs: Def[] = [
        { name: 'Zeta', description: 'last' },
        { name: 'alpha', description: 'FIRST one' },
        { name: 'Beta', description: 'middle' },
    ];
    const toItem = (d: Def): SuggestionItem => ({ label: d.name, insertText: d.name });

    it('sorts case-insensitively by sortKey', () => {
        const items = sortedSuggestions(
            defs,
            '',
            (d) => d.name,
            (d) => d.name,
            toItem
        );
        expect(items.map((i) => i.label)).toEqual(['alpha', 'Beta', 'Zeta']);
    });

    it('filters by case-insensitive substring over the searchable text (descriptions too)', () => {
        const items = sortedSuggestions(
            defs,
            'first',
            (d) => `${d.name} ${d.description}`,
            (d) => d.name,
            toItem
        );
        expect(items.map((i) => i.label)).toEqual(['alpha']);
    });

    it('does not mutate the input definition list', () => {
        sortedSuggestions(
            defs,
            '',
            (d) => d.name,
            (d) => d.name,
            toItem
        );
        expect(defs.map((d) => d.name)).toEqual(['Zeta', 'alpha', 'Beta']);
    });
});

describe('promptForTodoText', () => {
    let created: FakeQuickPick<vscode.QuickPickItem>[];

    beforeEach(() => {
        created = installFakeQuickPick();
    });

    function start(): { promise: Promise<string | undefined>; qp: FakeQuickPick<SuggestionItem> } {
        const promise = promptForTodoText(makeDoc(FIXTURE), {
            prompt: 'Add item',
            placeHolder: 'type here',
        });
        return { promise, qp: created[0] as unknown as FakeQuickPick<SuggestionItem> };
    }

    it('configures the picker to keep OUR order: matching and label sorting disabled', () => {
        const { qp } = start();
        expect(qp.title).toBe('Add item');
        expect(qp.placeholder).toBe('type here');
        expect(qp.matchOnDescription).toBe(false);
        expect(qp.matchOnDetail).toBe(false);
        expect(qp.matchOnLabel).toBe(false);
        expect(qp.sortByLabel).toBe(false);
        expect(qp.ignoreFocusOut).toBe(true);
        expect(qp.visible).toBe(true);
        qp.hide();
    });

    it('typing @ lists all users sorted case-insensitively by shortname', () => {
        const { qp } = start();
        qp.type('Fix login @');
        expect(qp.items.map((i) => i.label)).toEqual(['@alice', '@Bob-dev', '@zed']);
        expect(qp.items.every((i) => i.alwaysShow)).toBe(true);
        qp.hide();
    });

    it('typing a partial filters over shortname, fullname, AND description', () => {
        const { qp } = start();
        qp.type('@smith'); // matches only via the fullname "Alice Smith"
        expect(qp.items.map((i) => i.label)).toEqual(['@alice']);
        qp.type('@ops'); // matches only via the description "ops person"
        expect(qp.items.map((i) => i.label)).toEqual(['@zed']);
        qp.hide();
    });

    it('typing # lists tags and [ lists projects with backticked insertText', () => {
        const { qp } = start();
        qp.type('task #');
        expect(qp.items.map((i) => i.label)).toEqual(['#alpha', '#beta-2']);
        qp.type('task [');
        expect(qp.items.map((i) => i.label)).toEqual(['[Tools]', '[webapp]']);
        expect(qp.items.map((i) => i.insertText)).toEqual(['`[Tools]`', '`[webapp]`']);
        qp.hide();
    });

    it('a value with no trailing token shows no suggestions', () => {
        const { qp } = start();
        qp.type('plain text');
        expect(qp.items).toEqual([]);
        qp.hide();
    });

    it('accepting a highlighted suggestion inserts it, keeps the picker open, and clears items', () => {
        const { qp } = start();
        qp.type('Fix login @al');
        qp.activeItems = [qp.items[0]];
        qp.accept();
        expect(qp.value).toBe('Fix login @alice ');
        expect(qp.items).toEqual([]);
        expect(qp.visible).toBe(true);
        qp.hide();
    });

    it('accepting with no highlighted item submits the value', async () => {
        const { promise, qp } = start();
        qp.type('Fix login @al');
        qp.activeItems = [qp.items[0]];
        qp.accept();
        qp.type(qp.value + '#alpha done');
        qp.activeItems = [];
        qp.accept();
        await expect(promise).resolves.toBe('Fix login @alice #alpha done');
        expect(qp.disposed).toBe(true);
    });

    it('submitting an empty value resolves undefined', async () => {
        const { promise, qp } = start();
        qp.accept();
        await expect(promise).resolves.toBeUndefined();
    });

    it('hiding the picker (Esc) resolves undefined and disposes it', async () => {
        const { promise, qp } = start();
        qp.type('half-typed');
        qp.hide();
        await expect(promise).resolves.toBeUndefined();
        expect(qp.disposed).toBe(true);
    });
});
