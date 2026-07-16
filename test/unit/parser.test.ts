/**
 * Golden-fixture tests for the pure parser (Phase 5, F-15). The fixtures in
 * test/fixtures/ are loaded as raw strings and every expectation below pins
 * CURRENT behavior — including the quirks (duplicate section headers, the
 * blank-line parentStack reset, the 20-line frontmatter search window) —
 * so any future parser change that shifts them is a conscious decision.
 */
import { describe, expect, it } from 'vitest';
import { parseDocument } from '../../src/core/parse/parser';
import { isTodoContent } from '../../src/core/parse/detect';
import { classifyItemSection } from '../../src/core/parse/sections';
import { makeDoc, loadFixture } from './helpers';

const golden = parseDocument(makeDoc(loadFixture('parser-golden.md')));
const variants = parseDocument(makeDoc(loadFixture('sections-variants.md')));

describe('parseDocument — sections (parser-golden.md)', () => {
    it('maps every ## header to a lowercased key with inclusive line ranges', () => {
        expect([...golden.sections.entries()].map(([k, r]) => `${k}:${r.start}-${r.end}`)).toEqual([
            'active:2-15',
            'completed:16-19',
            'archive:20-23',
            'users:24-30',
            'tags:31-35',
            'projects:36-40',
        ]);
    });

    it('the final section extends to the last line of the document (EOF close)', () => {
        expect(golden.sections.get('projects')).toEqual({ start: 36, end: 40 });
    });

    it('a top-level "# Title" heading is not a section', () => {
        expect(golden.sections.size).toBe(6);
    });
});

describe('parseDocument — sections edge cases (sections-variants.md)', () => {
    it('duplicate section headers (case variants included): the LAST occurrence wins in the map', () => {
        // "## Active" (line 3) and "## ACTIVE" (line 5) share the key
        // 'active'; the second set() overwrites the first. Pinned quirk.
        expect(variants.sections.get('active')).toEqual({ start: 5, end: 6 });
        expect(variants.sections.size).toBe(2);
        expect(variants.sections.get('notes and ideas')).toEqual({ start: 7, end: 9 });
    });

    it('items before any section still parse, but classify to no section', () => {
        const before = variants.items.find((i) => i.line === 1)!;
        expect(before.text).toBe('Item before any section');
        expect(classifyItemSection(before, variants)).toBeNull();
    });

    it('an item under the FIRST duplicate Active header becomes unclassifiable (pinned quirk)', () => {
        const first = variants.items.find((i) => i.line === 4)!;
        expect(classifyItemSection(first, variants)).toBeNull();
    });

    it('an item under a case-variant "## ACTIVE" header classifies as active', () => {
        const dup = variants.items.find((i) => i.line === 6)!;
        expect(classifyItemSection(dup, variants)).toBe('active');
    });

    it('items in custom-named sections classify to null', () => {
        const custom = variants.items.find((i) => i.line === 8)!;
        expect(classifyItemSection(custom, variants)).toBeNull();
    });

    it('missing definition sections yield empty definition lists', () => {
        expect(variants.tagDefinitions).toEqual([]);
        expect(variants.userDefinitions).toEqual([]);
        expect(variants.projectDefinitions).toEqual([]);
    });
});

describe('parseDocument — nesting and re-parenting (parser-golden.md)', () => {
    it('builds the expected top-level item list', () => {
        expect(golden.items.map((i) => `${i.line}:${i.text}`)).toEqual([
            '4:Top task #alpha @alice',
            '10:Sibling spaced',
            '12:After blank line',
            '18:Done item',
            '22:Old item',
        ]);
    });

    it('nests children by indent and re-parents on dedent', () => {
        const top = golden.items[0];
        // Line 9 (indent 2) comes after the grandchild (indent 4): the stack
        // pops both the grandchild and its parent, re-attaching to the top item.
        expect(top.children.map((c) => `${c.line}:${c.indent}`)).toEqual(['6:2', '9:2']);
        const child = top.children[0];
        expect(child.parent).toBe(top);
        expect(child.children.map((c) => `${c.line}:${c.indent}`)).toEqual(['8:4']);
        expect(child.children[0].parent).toBe(child);
        expect(golden.items[1].children).toEqual([]);
    });
});

describe('parseDocument — notes attachment (parser-golden.md)', () => {
    it('attaches a note to the nearest shallower item on the stack', () => {
        expect(golden.items[0].notes).toEqual(['- Note on top task']);
    });

    it('attaches notes under nested items to the nested item, not the root', () => {
        const child = golden.items[0].children[0];
        expect(child.notes).toEqual(['- Note on child task']);
        expect(child.children[0].notes).toEqual([]);
    });

    it('a blank line resets the parent stack: a following indented bullet is orphaned (pinned)', () => {
        // Line 14 ("  - Orphan note after blank line") follows the blank line
        // 13, which cleared the stack — the note attaches to nothing.
        const after = golden.items.find((i) => i.line === 12)!;
        expect(after.notes).toEqual([]);
        for (const item of golden.items) {
            expect(item.notes).not.toContain('- Orphan note after blank line');
        }
    });
});

describe('parseDocument — dates, checkboxes, tokens (parser-golden.md)', () => {
    it('extracts added and completed dates', () => {
        const grandchild = golden.items[0].children[0].children[0];
        expect(grandchild.addedDate).toBe('2026-07-02');
        expect(grandchild.completedDate).toBe('2026-07-10');
        const sibling = golden.items[1];
        expect(sibling.addedDate).toBeUndefined();
        expect(sibling.completedDate).toBe('2026-07-03');
    });

    it('accepts mixed-case checkboxes: [X] parses as complete', () => {
        const grandchild = golden.items[0].children[0].children[0];
        expect(grandchild.isComplete).toBe(true);
        expect(grandchild.raw).toContain('[X]');
        expect(golden.items[0].isComplete).toBe(false);
        expect(golden.items[1].isComplete).toBe(true);
    });

    it('extracts tags, mentions, and the backticked project token', () => {
        const top = golden.items[0];
        expect(top.tags).toEqual(['alpha']);
        expect(top.mentions).toEqual(['alice']);
        expect(top.project).toBe('webapp');
        const child = top.children[0];
        expect(child.tags).toEqual(['beta-2']);
        expect(child.mentions).toEqual(['bob-dev']);
        expect(child.project).toBeUndefined();
        const second = top.children[1];
        expect(second.tags).toEqual(['alpha', 'gamma']);
        expect(second.project).toBe('tools');
    });

    it('strips date and project tokens from text and collapses runs of spaces', () => {
        expect(golden.items[0].text).toBe('Top task #alpha @alice');
        expect(golden.items[1].text).toBe('Sibling spaced');
        expect(golden.items[0].children[1].text).toBe('Second child #alpha #gamma');
    });
});

describe('parseDocument — definitions (parser-golden.md)', () => {
    it('parses tag definitions and sorts them case-insensitively by name', () => {
        expect(golden.tagDefinitions).toEqual([
            { name: 'alpha', description: 'first tag', line: 34 },
            { name: 'beta-2', description: 'second tag', line: 33 },
        ]);
    });

    it('parses user definitions with the fullname group OPTIONAL, sorted by shortname', () => {
        expect(golden.userDefinitions).toEqual([
            { shortname: 'alice', fullname: 'Alice Smith', description: 'frontend dev', line: 27 },
            { shortname: 'Bob-dev', fullname: 'Bob Dev', description: 'backend dev', line: 28 },
            { shortname: 'zed', fullname: '', description: 'no fullname user', line: 26 },
        ]);
    });

    it('parses project definitions sorted case-insensitively by name', () => {
        expect(golden.projectDefinitions).toEqual([
            { name: 'Tools', description: 'internal tools', line: 39 },
            { name: 'webapp', description: 'the web app', line: 38 },
        ]);
    });

    it('ignores non-definition lines inside definition sections', () => {
        expect(golden.userDefinitions.map((u) => u.line)).not.toContain(29);
    });
});

describe('isTodoContent — frontmatter detection edge cases', () => {
    const lines = (...ls: string[]) => makeDoc(ls.join('\n'));

    it('accepts the minimal three-line frontmatter', () => {
        expect(isTodoContent(lines('---', 'md-todo: true', '---'))).toBe(true);
    });

    it('rejects documents shorter than 3 lines', () => {
        expect(isTodoContent(lines('---', 'md-todo: true'))).toBe(false);
    });

    it('rejects when the first line is not the opening fence', () => {
        expect(isTodoContent(lines('', '---', 'md-todo: true', '---'))).toBe(false);
    });

    it('rejects when there is no closing fence', () => {
        expect(isTodoContent(lines('---', 'md-todo: true', 'title: x', ''))).toBe(false);
    });

    it('rejects md-todo: false', () => {
        expect(isTodoContent(lines('---', 'md-todo: false', '---'))).toBe(false);
    });

    it('accepts case-insensitive key/value and flexible whitespace', () => {
        expect(isTodoContent(lines('---', 'MD-Todo:  TRUE', '---'))).toBe(true);
        expect(isTodoContent(lines('---', 'md-todo:true', '---'))).toBe(true);
    });

    it('matches by prefix: trailing content after "true" is accepted (pinned)', () => {
        expect(isTodoContent(lines('---', 'md-todo: true # yes really', '---'))).toBe(true);
    });

    it('rejects md-todo: true appearing AFTER the closing fence', () => {
        expect(isTodoContent(lines('---', 'title: x', '---', 'md-todo: true'))).toBe(false);
    });

    it('20-line search window (pinned): closing fence at line 19 works, at line 20 does not', () => {
        const pad = Array.from({ length: 17 }, (_, i) => `key${i}: v`);
        // Closing fence at index 19 — the last line the search visits.
        expect(isTodoContent(lines('---', 'md-todo: true', ...pad, '---'))).toBe(true);
        // One more padding line pushes the fence to index 20 — out of the
        // window, so the file is NOT a todo file even though md-todo: true
        // sits at line 1. This is the documented 20-line frontmatter limit.
        expect(isTodoContent(lines('---', 'md-todo: true', ...pad, 'one: more', '---'))).toBe(
            false
        );
    });
});
