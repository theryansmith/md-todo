/**
 * Phase 5 feature tests: the three activity reports as deterministic
 * markdown snapshots for a fixed clock (2026-07-15) and fixture — extending
 * the pure renderCompletedItemLines tests in test/focus-activity.test.ts
 * with the full report flow: range/threshold QuickPicks (presets and the
 * custom input path), grouping, ordering, parent context, and the
 * empty-report fallback.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import {
    showRecentlyCompleted,
    showRecentlyAdded,
    showStaleItems,
} from '../../src/features/reports/activity-reports';
import { clearParseCache } from '../../src/vscode/document-cache';
import { makeEditableEditor } from './harness';

const FIXTURE = [
    '---',
    'md-todo: true',
    '---',
    '',
    '## Active',
    '',
    '- [ ] Old open task `+2026-05-01` @alice',
    '- [ ] Newer open task `+2026-07-13`',
    '- [ ] Undated open task',
    '',
    '## Completed',
    '',
    '- [x] Parent chore `+2026-07-01` `✓2026-07-14`',
    '  - Context note `+2026-07-01`',
    '  - [x] Child fix `+2026-07-10` `✓2026-07-14`',
    '- [x] Quick win `+2026-07-14` `✓2026-07-15`',
    '- [x] Same day ship `+2026-07-12` `✓2026-07-12`',
    '- [x] Ancient `+2026-01-01` `✓2026-02-01`',
    '',
].join('\n');

let opened: { content: string; language: string }[];
let quickPickResponder: (
    items: readonly vscode.QuickPickItem[]
) => vscode.QuickPickItem | undefined;
let inputBoxResponse: string | undefined;

const win = vscode.window as unknown as {
    showQuickPick(
        items: readonly vscode.QuickPickItem[],
        options?: unknown
    ): Thenable<vscode.QuickPickItem | undefined>;
    showInputBox(options?: unknown): Thenable<string | undefined>;
    showTextDocument(doc: unknown, options?: unknown): Thenable<unknown>;
    showWarningMessage(msg: string): Thenable<undefined>;
    visibleTextEditors: vscode.TextEditor[];
};
const ws = vscode.workspace as unknown as {
    openTextDocument(options: { content: string; language: string }): Thenable<unknown>;
};

beforeEach(() => {
    clearParseCache();
    // Wednesday 2026-07-15 — every relative range below is deterministic.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 6, 15, 12, 0, 0));
    opened = [];
    quickPickResponder = () => undefined;
    inputBoxResponse = undefined;
    win.showQuickPick = (items) => Promise.resolve(quickPickResponder(items));
    win.showInputBox = () => Promise.resolve(inputBoxResponse);
    win.showTextDocument = () => Promise.resolve(undefined);
    win.showWarningMessage = () => Promise.resolve(undefined);
    win.visibleTextEditors = [];
    ws.openTextDocument = (options) => {
        opened.push(options);
        return Promise.resolve(options);
    };
});

afterEach(() => {
    vi.useRealTimers();
});

const pickLabel = (label: string) => (items: readonly vscode.QuickPickItem[]) =>
    items.find((i) => i.label === label);

describe('showRecentlyCompleted', () => {
    it('renders the exact grouped report for "Last 7 days" (newest date first, parent context inline)', async () => {
        const ed = makeEditableEditor(FIXTURE);
        quickPickResponder = pickLabel('Last 7 days');
        await showRecentlyCompleted(ed.editor);
        expect(opened).toHaveLength(1);
        expect(opened[0].language).toBe('markdown');
        expect(opened[0].content.split('\n')).toEqual([
            '# 📅 Recently Completed — last 7 days',
            '',
            '**Range:** 2026-07-08 → 2026-07-15',
            '**Total:** 4 items completed',
            '',
            '## 2026-07-15 (1)',
            '- Quick win — added 2026-07-14, completed in 1 days',
            '',
            '## 2026-07-14 (2)',
            '- Parent chore — added 2026-07-01, completed in 13 days',
            '- Child fix — added 2026-07-10, completed in 4 days',
            '  - _Parent: Parent chore_',
            '    - Context note `+2026-07-01`',
            '',
            '## 2026-07-12 (1)',
            '- Same day ship — added 2026-07-12, completed in 0 days',
            '',
        ]);
    });

    it('supports the Custom… range via input box and renders the empty-report fallback', async () => {
        const ed = makeEditableEditor(FIXTURE);
        quickPickResponder = pickLabel('Custom…');
        inputBoxResponse = '2020-01-01';
        await showRecentlyCompleted(ed.editor);
        expect(opened[0].content.split('\n')).toEqual([
            '# 📅 Recently Completed — 2020-01-01',
            '',
            '**Range:** 2020-01-01 → 2020-01-01',
            '**Total:** 0 items completed',
            '',
            '_(no matching items)_',
        ]);
    });

    it('cancelling the range pick opens no report', async () => {
        const ed = makeEditableEditor(FIXTURE);
        quickPickResponder = () => undefined;
        await showRecentlyCompleted(ed.editor);
        expect(opened).toEqual([]);
    });
});

describe('showRecentlyAdded', () => {
    it('renders the exact grouped report for "This week", marking completed items', async () => {
        const ed = makeEditableEditor(FIXTURE);
        quickPickResponder = pickLabel('This week');
        await showRecentlyAdded(ed.editor);
        expect(opened[0].content.split('\n')).toEqual([
            '# 📅 Recently Added — this week',
            '',
            '**Range:** 2026-07-13 → 2026-07-15',
            '**Total:** 2 items added',
            '',
            '## 2026-07-14 (1)',
            '- Quick win — ✓ completed 2026-07-15',
            '',
            '## 2026-07-13 (1)',
            '- Newer open task',
            '',
        ]);
    });
});

describe('showStaleItems', () => {
    it('renders incomplete items at or past the threshold, oldest first', async () => {
        const ed = makeEditableEditor(FIXTURE);
        quickPickResponder = pickLabel('30 days');
        await showStaleItems(ed.editor);
        expect(opened[0].content.split('\n')).toEqual([
            '# 📅 Stale Items — older than 30 days',
            '',
            '**Total:** 1 incomplete items older than 30 days',
            '',
            '- (75 days old) Old open task @alice',
        ]);
    });

    it('offers the default threshold from settings among the presets, deduplicated', async () => {
        const ed = makeEditableEditor(FIXTURE);
        let seen: string[] = [];
        quickPickResponder = (items) => {
            seen = items.map((i) => i.label);
            return undefined;
        };
        await showStaleItems(ed.editor);
        expect(seen).toEqual(['7 days', '14 days', '30 days', '60 days', '90 days', 'Custom…']);
        expect(opened).toEqual([]);
    });

    it('supports a custom numeric threshold via the input box', async () => {
        const ed = makeEditableEditor(FIXTURE);
        quickPickResponder = pickLabel('Custom…');
        inputBoxResponse = '2';
        await showStaleItems(ed.editor);
        const lines = opened[0].content.split('\n');
        expect(lines[0]).toBe('# 📅 Stale Items — older than 2 days');
        // Both dated incomplete items qualify now; oldest first.
        expect(lines.slice(4)).toEqual([
            '- (75 days old) Old open task @alice',
            '- (2 days old) Newer open task',
        ]);
    });
});
