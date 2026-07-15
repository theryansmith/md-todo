/**
 * Phase 5 feature tests: the Show Stats report — exact markdown output for a
 * fixed clock (2026-07-15, noon) and fixture, including the velocity math,
 * the top-5 oldest open items, and the N/A / fallback branches.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { showStats } from '../../src/features/reports/commands-stats';
import { clearParseCache } from '../../src/vscode/document-cache';
import { makeEditableEditor } from './harness';

const FIXTURE = [
    '---',
    'md-todo: true',
    '---',
    '',
    '## Active',
    '',
    '- [ ] Oldest `+2026-06-01`',
    '- [ ] Mid `+2026-07-01`',
    '- [ ] Undated',
    '',
    '## Completed',
    '',
    '- [x] Fast `+2026-07-09` `✓2026-07-10`',
    '- [x] Slow `+2026-07-01` `✓2026-07-05`',
    '- [x] Boundary `✓2026-07-08`',
    '',
].join('\n');

let opened: { content: string; language: string }[];
let warnings: string[];

const win = vscode.window as unknown as {
    showWarningMessage(msg: string): Thenable<undefined>;
    showTextDocument(doc: unknown, options?: unknown): Thenable<unknown>;
};
const ws = vscode.workspace as unknown as {
    openTextDocument(options: { content: string; language: string }): Thenable<unknown>;
};

beforeEach(() => {
    clearParseCache();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 6, 15, 12, 0, 0));
    opened = [];
    warnings = [];
    ws.openTextDocument = (options) => {
        opened.push(options);
        return Promise.resolve(options);
    };
    win.showTextDocument = () => Promise.resolve(undefined);
    win.showWarningMessage = (msg) => {
        warnings.push(msg);
        return Promise.resolve(undefined);
    };
});

afterEach(() => {
    vi.useRealTimers();
});

describe('showStats', () => {
    it('renders the exact stats markdown for the fixed clock', async () => {
        const ed = makeEditableEditor(FIXTURE);
        await showStats(ed.editor);
        expect(opened).toHaveLength(1);
        expect(opened[0].language).toBe('markdown');
        expect(opened[0].content.split('\n')).toEqual([
            '# 📊 Todo Stats',
            '',
            '## Overview',
            '- **Total items:** 6',
            '- **Completed:** 3',
            '- **Incomplete:** 3',
            '',
            '## Velocity',
            // "Boundary" completed exactly 7 days ago at local midnight is
            // OLDER than now-minus-7-days (noon) — excluded. Pinned.
            '- **Completed this week:** 1',
            // (1 day for Fast + 4 days for Slow) / 2 — Boundary has no
            // added date, so it contributes no completion time.
            '- **Avg completion time:** 2.5 days',
            '',
            '## Oldest Open Items',
            // Ages are rounded from the RAW clock (noon), not local midnight:
            // 44.5 days rounds up to 45. Pinned current behavior.
            '- Oldest (45 days old)',
            '- Mid (15 days old)',
        ]);
    });

    it('falls back to N/A and the no-dated-items line when nothing is dated', async () => {
        const ed = makeEditableEditor(
            [
                '---',
                'md-todo: true',
                '---',
                '',
                '- [ ] Undated only',
                '- [x] Done undated',
                '',
            ].join('\n')
        );
        await showStats(ed.editor);
        const lines = opened[0].content.split('\n');
        expect(lines).toContain('- **Avg completion time:** N/A days');
        expect(lines).toContain('- **Completed this week:** 0');
        expect(lines[lines.length - 1]).toBe('- No dated incomplete items');
    });

    it('warns and opens nothing for a non-todo file', async () => {
        const ed = makeEditableEditor('# nope');
        await showStats(ed.editor);
        expect(warnings).toContain('Not a todo file. Add "md-todo: true" to YAML frontmatter.');
        expect(opened).toEqual([]);
    });
});
