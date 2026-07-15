import { describe, expect, it } from 'vitest';
import { markLineComplete } from '../src/features/items/commands-mark-done';
import { computeTagsLine } from '../src/features/tags/commands-add-tags';
import { computeProjectLine } from '../src/features/projects/commands-set-project';
import { parseDocument } from '../src/core/parser';
import { makeDoc } from './helpers';

const TODAY = '2026-07-10';

describe('markLineComplete — project token preservation', () => {
    it('preserves the token when the line has an existing `+date`', () => {
        const line = '- [ ] Ship rework `+2026-07-01` `[game-x]` #work';
        const out = markLineComplete(line, TODAY);
        expect(out).toBe('- [x] Ship rework `+2026-07-01` `✓2026-07-10` `[game-x]` #work');
        expect(out).toContain('`[game-x]`');
    });

    it('preserves the token when the line has no `+date`', () => {
        const line = '- [ ] Ship rework `[game-x]` #work';
        const out = markLineComplete(line, TODAY);
        expect(out).toBe('- [x] Ship rework `[game-x]` #work `✓2026-07-10`');
        expect(out).toContain('`[game-x]`');
    });
});

describe('computeTagsLine — project token preservation', () => {
    it('leaves the project token intact when rewriting tags', () => {
        const line = '- [ ] Ship rework `+2026-07-01` `[game-x]` #work #urgent';
        const out = computeTagsLine(line, ['reading']);
        expect(out).toContain('`[game-x]`');
        expect(out).toBe('- [ ] Ship rework `+2026-07-01` `[game-x]` #reading');
    });

    it('leaves the project token intact when removing all tags', () => {
        const line = '- [ ] Ship rework `[game-x]` #work';
        const out = computeTagsLine(line, []);
        expect(out).toBe('- [ ] Ship rework `[game-x]`');
    });
});

describe('computeProjectLine', () => {
    it('sets a project on a line without one', () => {
        const out = computeProjectLine('- [ ] Ship rework `+2026-07-01` #work', 'game-x');
        expect(out).toBe('- [ ] Ship rework `+2026-07-01` #work `[game-x]`');
    });

    it('changes an existing project', () => {
        // Mid-line token removal leaves a double space (only trailing
        // whitespace is trimmed); the parser collapses it in display text.
        const out = computeProjectLine('- [ ] Ship rework `[old-proj]` #work', 'game-x');
        expect(out).toBe('- [ ] Ship rework  #work `[game-x]`');
    });

    it('removes the project when name is undefined', () => {
        const out = computeProjectLine('- [ ] Ship rework `[game-x]` #work', undefined);
        expect(out).toBe('- [ ] Ship rework  #work');
    });

    it('normalizes a two-token line down to a single token', () => {
        const out = computeProjectLine('- [ ] double `[alpha]` mid `[beta]`', 'game-x');
        expect(out).toBe('- [ ] double  mid `[game-x]`');
    });

    it('output re-parses to the expected project', () => {
        const line = computeProjectLine('- [ ] Ship rework `+2026-07-01` #work @jdoe', 'game-x');
        const doc = makeDoc(`## Active\n\n${line}`);
        const item = parseDocument(doc).items[0];
        expect(item.project).toBe('game-x');
        expect(item.tags).toEqual(['work']);
        expect(item.mentions).toEqual(['jdoe']);
        expect(item.text).toBe('Ship rework #work @jdoe');
    });
});
