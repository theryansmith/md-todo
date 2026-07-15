import { describe, expect, it } from 'vitest';
import { collectUndefinedProjectNames } from '../tree-projects';
import { parseDocument } from '../parser';
import { makeDoc } from './helpers';

describe('collectUndefinedProjectNames', () => {
    it('reports used-but-undefined names, deduplicated across a subtree, sorted case-insensitively', () => {
        const doc = makeDoc(
            [
                '## Active',
                '',
                '- [ ] defined one `[game-x]`',
                '- [ ] ghost item `[Zephyr]`',
                '  - [ ] child inherits Zephyr',
                '- [ ] another ghost `[abandoned]`',
                '- [ ] no project at all',
                '',
                '## Projects',
                '',
                '**game-x**: The big title',
            ].join('\n')
        );
        const parsed = parseDocument(doc);
        expect(collectUndefinedProjectNames(parsed)).toEqual(['abandoned', 'Zephyr']);
    });

    it('returns an empty list when every used project is defined', () => {
        const doc = makeDoc(
            [
                '## Active',
                '',
                '- [ ] fine `[game-x]`',
                '- [ ] plain',
                '',
                '## Projects',
                '',
                '**game-x**: The big title',
            ].join('\n')
        );
        expect(collectUndefinedProjectNames(parseDocument(doc))).toEqual([]);
    });

    it('is case-sensitive against definitions: wrong-case usage counts as undefined', () => {
        const doc = makeDoc(
            [
                '## Active',
                '',
                '- [ ] wrong case `[Game-X]`',
                '',
                '## Projects',
                '',
                '**game-x**: The big title',
            ].join('\n')
        );
        expect(collectUndefinedProjectNames(parseDocument(doc))).toEqual(['Game-X']);
    });
});
