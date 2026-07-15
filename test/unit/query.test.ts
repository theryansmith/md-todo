/**
 * Boundary tests for core/query (Phase 5, F-15): line-geometry queries
 * (getItemEndLine, getItemWithDescendantsEndLine), source-line resolution
 * (findItemForSourceLine, findItemByLine), section classification,
 * tag validation, and activity matching against a fixed clock.
 */
import { describe, expect, it } from 'vitest';
import {
    findItemForSourceLine,
    findItemByLine,
    validateTags,
    isNestedItem,
    getItemEndLine,
    getItemWithDescendantsEndLine,
} from '../../src/core/query/items';
import { itemMatchesActivity } from '../../src/core/query/activity';
import { classifyItemSection } from '../../src/core/parse/sections';
import { parseDocument } from '../../src/core/parse/parser';
import { parseDate } from '../../src/core/dates';
import { TodoItem, ActivityFocus } from '../../src/core/model';
import { makeDoc } from './helpers';

// ── Line geometry ───────────────────────────────────────────────────────────

describe('getItemEndLine', () => {
    it('runs to EOF when the item block ends the document', () => {
        const doc = makeDoc(['- [ ] item', '  - note one', '  - note two'].join('\n'));
        expect(getItemEndLine(doc, 0)).toBe(2);
    });

    it('stops before a header', () => {
        const doc = makeDoc(['- [ ] item', '  - note', '## Completed', '- [x] other'].join('\n'));
        expect(getItemEndLine(doc, 0)).toBe(1);
    });

    it('stops before a same-indent sibling checkbox', () => {
        const doc = makeDoc(['- [ ] a', '  - note', '- [ ] b'].join('\n'));
        expect(getItemEndLine(doc, 0)).toBe(1);
    });

    it('a blank line between block lines is skipped, and rides along when a sibling follows (pinned)', () => {
        const doc = makeDoc(['- [ ] a', '  - note', '', '- [ ] b'].join('\n'));
        // The blank line 2 is included in the block: the boundary is the
        // sibling checkbox at line 3, so the end is 3 - 1 = 2.
        expect(getItemEndLine(doc, 0)).toBe(2);
    });

    it('includes deeper nested todos, then stops at a SHALLOWER checkbox (deeper-then-shallower)', () => {
        const doc = makeDoc(
            ['  - [ ] mid', '    - [ ] deep', '      - deep note', '- [ ] shallow'].join('\n')
        );
        expect(getItemEndLine(doc, 0)).toBe(2);
    });

    it('a deeper same-indent nested todo does NOT terminate a top-level block', () => {
        const doc = makeDoc(['- [ ] a', '  - [ ] child', '  - note after child'].join('\n'));
        expect(getItemEndLine(doc, 0)).toBe(2);
    });

    it('stops before an arbitrary non-note, non-todo line (pinned)', () => {
        const doc = makeDoc(['- [ ] a', '  - note', '    plain paragraph text'].join('\n'));
        // "plain paragraph text" is neither a note bullet nor a checkbox —
        // the block ends on the line before it.
        expect(getItemEndLine(doc, 0)).toBe(1);
    });
});

describe('getItemWithDescendantsEndLine', () => {
    function firstItem(text: string): { doc: ReturnType<typeof makeDoc>; item: TodoItem } {
        const doc = makeDoc(text);
        const parsed = parseDocument(doc);
        return { doc, item: parsed.items[0] };
    }

    it('runs to EOF including trailing blank lines (pinned)', () => {
        const { doc, item } = firstItem(['- [ ] a', '  - [ ] child', ''].join('\n'));
        expect(getItemWithDescendantsEndLine(doc, item)).toBe(2);
    });

    it('stops at a header line', () => {
        const { doc, item } = firstItem(
            ['- [ ] a', '  - note', '## Completed', '- [x] done'].join('\n')
        );
        expect(getItemWithDescendantsEndLine(doc, item)).toBe(1);
    });

    it('stops at the first non-blank line at the same or shallower indent', () => {
        const { doc, item } = firstItem(
            ['- [ ] a', '  - [ ] child', '    - grandnote', '- [ ] sibling'].join('\n')
        );
        expect(getItemWithDescendantsEndLine(doc, item)).toBe(2);
    });

    it('interior blank lines extend the subtree up to the boundary (pinned)', () => {
        const { doc, item } = firstItem(
            ['- [ ] a', '  - [ ] child', '', '  - late note', '- [ ] sibling'].join('\n')
        );
        expect(getItemWithDescendantsEndLine(doc, item)).toBe(3);
    });

    it('deeper-then-shallower: a nested subtree ends when indentation returns to the item level', () => {
        const doc = makeDoc(
            ['- [ ] top', '  - [ ] mid', '    - [ ] deep', '  - [ ] mid2', '- [ ] next'].join('\n')
        );
        const parsed = parseDocument(doc);
        const mid = parsed.items[0].children[0];
        expect(getItemWithDescendantsEndLine(doc, mid)).toBe(2);
        expect(getItemWithDescendantsEndLine(doc, parsed.items[0])).toBe(3);
    });
});

// ── Source-line resolution ──────────────────────────────────────────────────

describe('findItemForSourceLine', () => {
    const parsed = parseDocument(
        makeDoc(
            [
                '## Active',
                '- [ ] top',
                '  - top note one',
                '  - top note two',
                '  - [ ] child',
                '    - child note',
                '',
                '- [ ] second',
            ].join('\n')
        )
    );

    it('resolves an item line to the item itself', () => {
        expect(findItemForSourceLine(1, parsed)!.text).toBe('top');
        expect(findItemForSourceLine(7, parsed)!.text).toBe('second');
    });

    it('resolves note lines to the owning item', () => {
        expect(findItemForSourceLine(2, parsed)!.text).toBe('top');
        expect(findItemForSourceLine(3, parsed)!.text).toBe('top');
    });

    it('resolves a note under a NESTED item to the nested item, not the root', () => {
        expect(findItemForSourceLine(5, parsed)!.text).toBe('child');
    });

    it('resolves a nested item line to the nested item', () => {
        expect(findItemForSourceLine(4, parsed)!.text).toBe('child');
    });

    it('returns null for header and blank lines', () => {
        expect(findItemForSourceLine(0, parsed)).toBeNull();
        expect(findItemForSourceLine(6, parsed)).toBeNull();
        expect(findItemForSourceLine(99, parsed)).toBeNull();
    });
});

describe('findItemByLine / isNestedItem', () => {
    const parsed = parseDocument(makeDoc(['- [ ] top', '  - [ ] child'].join('\n')));

    it('finds items recursively by exact line, and only by exact line', () => {
        expect(findItemByLine(parsed.items, 0)!.text).toBe('top');
        expect(findItemByLine(parsed.items, 1)!.text).toBe('child');
        expect(findItemByLine(parsed.items, 2)).toBeNull();
    });

    it('isNestedItem is true exactly when the item has a parent', () => {
        expect(isNestedItem(parsed.items[0])).toBe(false);
        expect(isNestedItem(parsed.items[0].children[0])).toBe(true);
    });
});

// ── classifyItemSection ─────────────────────────────────────────────────────

describe('classifyItemSection', () => {
    const parsed = parseDocument(
        makeDoc(
            [
                '## Active',
                '- [ ] open',
                '## Completed',
                '- [x] done',
                '## Archive',
                '- [x] old',
                '## Ideas',
                '- [ ] someday',
            ].join('\n')
        )
    );
    const at = (line: number) => parsed.items.find((i) => i.line === line)!;

    it('classifies the three known sections', () => {
        expect(classifyItemSection(at(1), parsed)).toBe('active');
        expect(classifyItemSection(at(3), parsed)).toBe('completed');
        expect(classifyItemSection(at(5), parsed)).toBe('archive');
    });

    it('returns null for items in unknown sections', () => {
        expect(classifyItemSection(at(7), parsed)).toBeNull();
    });
});

// ── validateTags ────────────────────────────────────────────────────────────

describe('validateTags', () => {
    const defs = [
        { name: 'alpha', description: '', line: 0 },
        { name: 'beta', description: '', line: 1 },
    ];

    it('splits tags into defined and undefined, preserving input order', () => {
        expect(validateTags(['beta', 'nope', 'alpha', 'zzz'], defs)).toEqual({
            validTags: ['beta', 'alpha'],
            undefinedTags: ['nope', 'zzz'],
        });
    });

    it('everything is undefined against an empty definition list', () => {
        expect(validateTags(['alpha'], [])).toEqual({
            validTags: [],
            undefinedTags: ['alpha'],
        });
    });

    it('is case-sensitive (pinned)', () => {
        expect(validateTags(['Alpha'], defs).undefinedTags).toEqual(['Alpha']);
    });
});

// ── itemMatchesActivity ─────────────────────────────────────────────────────

describe('itemMatchesActivity', () => {
    // Fixed "today" — 2026-07-15 local midnight, matching the fixed clocks
    // used across the Phase 5 suites.
    const today = parseDate('2026-07-15')!;

    function item(overrides: Partial<TodoItem>): TodoItem {
        return {
            line: 0,
            text: 'x',
            isComplete: false,
            addedDate: undefined,
            completedDate: undefined,
            notes: [],
            raw: '- [ ] x',
            indent: 0,
            tags: [],
            mentions: [],
            project: undefined,
            children: [],
            parent: undefined,
            ...overrides,
        };
    }

    const completedRange: ActivityFocus = {
        kind: 'completed',
        startDate: '2026-07-01',
        endDate: '2026-07-10',
        label: 'range',
    };

    it('completed: matches inside the range, inclusive on BOTH boundary dates', () => {
        expect(
            itemMatchesActivity(item({ completedDate: '2026-07-05' }), completedRange, today)
        ).toBe(true);
        expect(
            itemMatchesActivity(item({ completedDate: '2026-07-01' }), completedRange, today)
        ).toBe(true);
        expect(
            itemMatchesActivity(item({ completedDate: '2026-07-10' }), completedRange, today)
        ).toBe(true);
    });

    it('completed: rejects outside the range, missing dates, and unparsable dates', () => {
        expect(
            itemMatchesActivity(item({ completedDate: '2026-06-30' }), completedRange, today)
        ).toBe(false);
        expect(
            itemMatchesActivity(item({ completedDate: '2026-07-11' }), completedRange, today)
        ).toBe(false);
        expect(itemMatchesActivity(item({}), completedRange, today)).toBe(false);
        expect(
            itemMatchesActivity(item({ completedDate: 'not-a-date' }), completedRange, today)
        ).toBe(false);
    });

    const addedRange: ActivityFocus = {
        kind: 'added',
        startDate: '2026-07-01',
        endDate: '2026-07-10',
        label: 'range',
    };

    it('added: matches on addedDate with inclusive boundaries', () => {
        expect(itemMatchesActivity(item({ addedDate: '2026-07-01' }), addedRange, today)).toBe(
            true
        );
        expect(itemMatchesActivity(item({ addedDate: '2026-07-10' }), addedRange, today)).toBe(
            true
        );
        expect(itemMatchesActivity(item({ addedDate: '2026-06-30' }), addedRange, today)).toBe(
            false
        );
        expect(itemMatchesActivity(item({}), addedRange, today)).toBe(false);
        expect(itemMatchesActivity(item({ addedDate: 'garbage' }), addedRange, today)).toBe(false);
    });

    const stale30: ActivityFocus = { kind: 'stale', staleDays: 30, label: 'older than 30 days' };

    it('stale: matches incomplete items whose age is >= staleDays (boundary exact)', () => {
        // 2026-06-15 → exactly 30 days before 2026-07-15.
        expect(itemMatchesActivity(item({ addedDate: '2026-06-15' }), stale30, today)).toBe(true);
        expect(itemMatchesActivity(item({ addedDate: '2026-06-16' }), stale30, today)).toBe(false);
        expect(itemMatchesActivity(item({ addedDate: '2026-01-01' }), stale30, today)).toBe(true);
    });

    it('stale: never matches complete or undated items', () => {
        expect(
            itemMatchesActivity(item({ addedDate: '2026-01-01', isComplete: true }), stale30, today)
        ).toBe(false);
        expect(itemMatchesActivity(item({}), stale30, today)).toBe(false);
        expect(itemMatchesActivity(item({ addedDate: 'garbage' }), stale30, today)).toBe(false);
    });

    it('stale with staleDays undefined matches every dated incomplete item (pinned ?? 0 fallback)', () => {
        const staleUnset: ActivityFocus = { kind: 'stale', label: 'stale' };
        expect(itemMatchesActivity(item({ addedDate: '2026-07-15' }), staleUnset, today)).toBe(
            true
        );
    });
});
