import { describe, expect, it } from 'vitest';
import { parseDocument } from '../../src/core/parse/parser';
import { makeDoc } from './helpers';

describe('parseDocument — project token extraction', () => {
    it('extracts the project and coexists with tags/mentions; token stripped from text', () => {
        const doc = makeDoc(
            ['## Active', '', '- [ ] Ship rework `+2026-07-10` `[game-x]` #work @jdoe'].join('\n')
        );
        const parsed = parseDocument(doc);
        expect(parsed.items).toHaveLength(1);
        const item = parsed.items[0];
        expect(item.project).toBe('game-x');
        expect(item.tags).toEqual(['work']);
        expect(item.mentions).toEqual(['jdoe']);
        expect(item.addedDate).toBe('2026-07-10');
        expect(item.text).toBe('Ship rework #work @jdoe');
    });

    it('leaves project undefined when there is no token', () => {
        const doc = makeDoc('## Active\n\n- [ ] plain item `+2026-07-01`');
        const item = parseDocument(doc).items[0];
        expect(item.project).toBeUndefined();
    });

    it('first token wins when two are present; both are stripped from text', () => {
        const doc = makeDoc('## Active\n\n- [ ] double `[alpha]` mid `[beta]` end');
        const item = parseDocument(doc).items[0];
        expect(item.project).toBe('alpha');
        expect(item.text).toBe('double mid end');
    });

    it('does not treat a markdown link as a project', () => {
        const doc = makeDoc('## Active\n\n- [ ] read [the docs](https://example.com)');
        const item = parseDocument(doc).items[0];
        expect(item.project).toBeUndefined();
        expect(item.text).toBe('read [the docs](https://example.com)');
    });

    it('a token in a note line does not set the item project', () => {
        const doc = makeDoc(
            ['## Active', '', '- [ ] parent item', '  - note mentioning `[side-quest]` here'].join(
                '\n'
            )
        );
        const item = parseDocument(doc).items[0];
        expect(item.project).toBeUndefined();
        expect(item.notes).toHaveLength(1);
    });

    it('accepts hyphen/digit/underscore names', () => {
        const doc = makeDoc('## Active\n\n- [ ] mixed `[proj_2-b]`');
        expect(parseDocument(doc).items[0].project).toBe('proj_2-b');
    });
});

describe('parseDocument — ## Projects definitions', () => {
    it('parses definitions with correct lines and sorts case-insensitively', () => {
        const doc = makeDoc(
            [
                '## Active',
                '',
                '- [ ] something',
                '',
                '## Projects',
                '',
                '**zeta**: last alphabetically',
                '**Alpha**: capitalized first',
                '**mid-one**: hyphenated middle',
            ].join('\n')
        );
        const defs = parseDocument(doc).projectDefinitions;
        expect(defs.map((d) => d.name)).toEqual(['Alpha', 'mid-one', 'zeta']);
        expect(defs.find((d) => d.name === 'zeta')!.line).toBe(6);
        expect(defs.find((d) => d.name === 'Alpha')!.line).toBe(7);
        expect(defs.find((d) => d.name === 'mid-one')!.description).toBe('hyphenated middle');
    });

    it('returns an empty list when there is no ## Projects section', () => {
        const doc = makeDoc('## Active\n\n- [ ] something');
        expect(parseDocument(doc).projectDefinitions).toEqual([]);
    });
});

describe('parseDocument — backward compatibility', () => {
    it('a token-free document parses identically, with project undefined', () => {
        const doc = makeDoc(
            [
                '## Active',
                '',
                '- [ ] Finish tech audit report `+2025-01-20` #work #urgent',
                '  - 2025-01-22: Got rendering section drafted',
                '- [x] Review perf docs `+2025-01-15` `✓2025-01-24` #reading @jdoe',
                '',
                '## Tags',
                '',
                '**work**: Work-related tasks',
            ].join('\n')
        );
        const parsed = parseDocument(doc);
        expect(parsed.items).toHaveLength(2);

        const first = parsed.items[0];
        expect(first.text).toBe('Finish tech audit report #work #urgent');
        expect(first.tags).toEqual(['work', 'urgent']);
        expect(first.mentions).toEqual([]);
        expect(first.addedDate).toBe('2025-01-20');
        expect(first.completedDate).toBeUndefined();
        expect(first.isComplete).toBe(false);
        expect(first.notes).toHaveLength(1);
        expect(first.project).toBeUndefined();

        const second = parsed.items[1];
        expect(second.text).toBe('Review perf docs #reading @jdoe');
        expect(second.isComplete).toBe(true);
        expect(second.completedDate).toBe('2025-01-24');
        expect(second.mentions).toEqual(['jdoe']);
        expect(second.project).toBeUndefined();

        expect(parsed.tagDefinitions.map((t) => t.name)).toEqual(['work']);
        expect(parsed.projectDefinitions).toEqual([]);
    });
});
