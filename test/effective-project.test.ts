import { describe, expect, it } from 'vitest';
import { parseDocument } from '../src/core/parse/parser';
import { getEffectiveProject, isDefinedProject } from '../src/core/query/activity';
import { ProjectDefinition } from '../src/core/model';
import { makeDoc } from './helpers';

describe('getEffectiveProject', () => {
    it('child inherits the parent project', () => {
        const doc = makeDoc(
            ['## Active', '', '- [ ] parent `[game-x]`', '  - [ ] child without token'].join('\n')
        );
        const parent = parseDocument(doc).items[0];
        expect(parent.children).toHaveLength(1);
        expect(getEffectiveProject(parent.children[0])).toBe('game-x');
    });

    it('grandchild inherits through two levels', () => {
        const doc = makeDoc(
            ['## Active', '', '- [ ] top `[game-x]`', '  - [ ] middle', '    - [ ] leaf'].join('\n')
        );
        const top = parseDocument(doc).items[0];
        const leaf = top.children[0].children[0];
        expect(getEffectiveProject(leaf)).toBe('game-x');
    });

    it('own token overrides the inherited one', () => {
        const doc = makeDoc(
            ['## Active', '', '- [ ] top `[game-x]`', '  - [ ] child `[side-quest]`'].join('\n')
        );
        const top = parseDocument(doc).items[0];
        expect(getEffectiveProject(top.children[0])).toBe('side-quest');
        expect(getEffectiveProject(top)).toBe('game-x');
    });

    it('returns undefined when no token anywhere in the ancestry', () => {
        const doc = makeDoc(['## Active', '', '- [ ] top', '  - [ ] child'].join('\n'));
        const top = parseDocument(doc).items[0];
        expect(getEffectiveProject(top.children[0])).toBeUndefined();
    });
});

describe('isDefinedProject', () => {
    const defs: ProjectDefinition[] = [
        { name: 'game-x', description: 'the big one', line: 10 },
        { name: 'Tools', description: 'internal tooling', line: 11 },
    ];

    it('finds a defined project', () => {
        expect(isDefinedProject('game-x', defs)).toBe(true);
    });

    it('is case-sensitive: wrong case does not match', () => {
        expect(isDefinedProject('Game-X', defs)).toBe(false);
        expect(isDefinedProject('tools', defs)).toBe(false);
    });

    it('rejects an unknown name', () => {
        expect(isDefinedProject('unknown', defs)).toBe(false);
    });
});
