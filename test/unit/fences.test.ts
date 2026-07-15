/**
 * F-17 tests: lines inside fenced code blocks (``` / ~~~) and HTML comment
 * blocks are excluded from parsing and token scanning. The unit block pins
 * the exact line-granular semantics of computeExcludedLines; the fixture
 * block proves the parser produces no items, sections, notes, or
 * definitions from excluded lines.
 */
import { describe, expect, it } from 'vitest';
import { computeExcludedLines, FENCE_OR_COMMENT_MARKER_RE } from '../../src/core/parse/fences';
import { parseDocument } from '../../src/core/parse/parser';
import { makeDoc, loadFixture } from './helpers';

function excludedLineNumbers(lines: string[]): number[] {
    const { excluded } = computeExcludedLines(makeDoc(lines.join('\n')));
    return excluded.flatMap((flag, i) => (flag ? [i] : []));
}

describe('computeExcludedLines — fenced code blocks', () => {
    it('excludes the delimiters and everything between', () => {
        expect(excludedLineNumbers(['text', '```', '- [ ] fake', '```', 'text'])).toEqual([
            1, 2, 3,
        ]);
    });

    it('an unclosed fence runs to EOF', () => {
        expect(excludedLineNumbers(['text', '```', 'a', 'b'])).toEqual([1, 2, 3]);
    });

    it('supports ~~~ fences, and one fence char does not close the other', () => {
        expect(excludedLineNumbers(['~~~', '```', 'still fenced', '~~~', 'out'])).toEqual([
            0, 1, 2, 3,
        ]);
    });

    it('allows an info string on the opening fence and leading indentation', () => {
        expect(excludedLineNumbers(['```markdown', 'x', '```'])).toEqual([0, 1, 2]);
        expect(excludedLineNumbers(['  ```', 'x', '  ```'])).toEqual([0, 1, 2]);
    });

    it('a closing fence must be the only content on its line (pinned)', () => {
        // "``` trailing" does not close; the fence keeps running.
        expect(excludedLineNumbers(['```', 'x', '``` trailing', 'y', '```', 'out'])).toEqual([
            0, 1, 2, 3, 4,
        ]);
    });

    it('a longer run of the same char closes (pinned simple semantics)', () => {
        expect(excludedLineNumbers(['```', 'x', '````', 'out'])).toEqual([0, 1, 2]);
    });

    it('comment markers inside a fence are ignored', () => {
        expect(excludedLineNumbers(['```', '<!--', '```', 'out'])).toEqual([0, 1, 2]);
    });
});

describe('computeExcludedLines — HTML comment blocks', () => {
    it('excludes a multi-line comment including the opener and the closing line', () => {
        expect(excludedLineNumbers(['a', '<!--', '- [ ] fake', '-->', 'b'])).toEqual([1, 2, 3]);
    });

    it('excludes a line that IS a single-line comment', () => {
        expect(excludedLineNumbers(['a', '<!-- - [ ] fake -->', 'b'])).toEqual([1]);
    });

    it('a trailing opener after real content keeps THAT line but excludes the continuation', () => {
        expect(
            excludedLineNumbers(['- [ ] real <!-- comment starts', '- [ ] fake', '-->', 'out'])
        ).toEqual([1, 2]);
    });

    it('a complete inline comment mid-line does not open a block', () => {
        expect(excludedLineNumbers(['- [ ] real <!-- aside --> more', 'next'])).toEqual([]);
    });

    it('an unclosed comment runs to EOF', () => {
        expect(excludedLineNumbers(['<!--', 'a', 'b'])).toEqual([0, 1, 2]);
    });

    it('fence markers inside a comment are ignored', () => {
        expect(excludedLineNumbers(['<!--', '```', '-->', 'out'])).toEqual([0, 1, 2]);
    });
});

describe('computeExcludedLines — marker signature', () => {
    it('counts every line containing a fence or comment marker', () => {
        const { markerLineCount } = computeExcludedLines(
            makeDoc(['```', 'plain', '```', '<!-- x -->', 'plain', '-->'].join('\n'))
        );
        expect(markerLineCount).toBe(4);
    });

    it('FENCE_OR_COMMENT_MARKER_RE matches exactly the marker tokens', () => {
        for (const positive of ['```', '````ts', 'a ~~~ b', 'x <!--', 'y -->']) {
            expect(FENCE_OR_COMMENT_MARKER_RE.test(positive), positive).toBe(true);
        }
        for (const negative of ['``', '~~', '<!', '--', '#tag `+2026-01-01`']) {
            expect(FENCE_OR_COMMENT_MARKER_RE.test(negative), negative).toBe(false);
        }
    });
});

describe('parseDocument with fences/comments (fenced-blocks.md)', () => {
    const parsed = parseDocument(makeDoc(loadFixture('fenced-blocks.md')));

    it('parses only the real todo items — nothing from fences or comments', () => {
        expect(parsed.items.map((i) => `${i.line}:${i.text}`)).toEqual([
            '4:Real task #real @dev',
            '12:Task after fence',
            '25:Trailing real <!-- opener after content',
        ]);
    });

    it('extracts tokens only from real lines', () => {
        expect(parsed.items[0].tags).toEqual(['real']);
        expect(parsed.items[0].mentions).toEqual(['dev']);
        const allTags = parsed.items.flatMap((i) => i.tags);
        expect(allTags).not.toContain('fake');
        expect(allTags).not.toContain('hidden');
    });

    it('## headers inside fences/comments do not become sections', () => {
        expect([...parsed.sections.keys()]).toEqual(['active', 'tags']);
        expect(parsed.sections.get('active')).toEqual({ start: 2, end: 28 });
    });

    it('definition lines inside a fenced block in a definitions section are skipped', () => {
        expect(parsed.tagDefinitions).toEqual([
            { name: 'real', description: 'a real tag', line: 35 },
        ]);
    });

    it('a fence between an item and its note does not detach the note', () => {
        const parsed2 = parseDocument(
            makeDoc(
                ['- [ ] item', '  ```', '  code', '  ```', '  - note after the fence'].join('\n')
            )
        );
        expect(parsed2.items[0].notes).toEqual(['- note after the fence']);
    });
});
