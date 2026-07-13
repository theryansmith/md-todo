import { describe, expect, it } from 'vitest';
import { PROJECT_TOKEN_RE, PROJECT_TOKEN_RE_G, formatProjectToken } from '../tokens';

describe('formatProjectToken', () => {
    it('round-trips through PROJECT_TOKEN_RE', () => {
        const token = formatProjectToken('game-x');
        expect(token).toBe('`[game-x]`');
        const m = token.match(PROJECT_TOKEN_RE);
        expect(m).not.toBeNull();
        expect(m![1]).toBe('game-x');
    });
});

describe('PROJECT_TOKEN_RE', () => {
    it('matches a backtick-wrapped bracket token inside a todo line', () => {
        const m = '- [ ] Ship rework `+2026-07-10` `[game-x]` #work @jdoe'.match(PROJECT_TOKEN_RE);
        expect(m).not.toBeNull();
        expect(m![1]).toBe('game-x');
    });

    it('does NOT match a markdown inline link', () => {
        expect('- [ ] see [text](https://x)'.match(PROJECT_TOKEN_RE)).toBeNull();
    });

    it('does NOT match a markdown reference link', () => {
        expect('- [ ] see [text][ref]'.match(PROJECT_TOKEN_RE)).toBeNull();
    });

    it('does NOT match a footnote reference', () => {
        expect('- [ ] with footnote [^1]'.match(PROJECT_TOKEN_RE)).toBeNull();
    });

    it('does NOT match the unchecked checkbox', () => {
        expect('- [ ] plain item'.match(PROJECT_TOKEN_RE)).toBeNull();
    });

    it('does NOT match the checked checkbox', () => {
        expect('- [x] done item'.match(PROJECT_TOKEN_RE)).toBeNull();
    });

    it('does NOT match bare brackets without backticks', () => {
        expect('- [ ] bare [brackets] here'.match(PROJECT_TOKEN_RE)).toBeNull();
    });

    it('does NOT match an empty token `[]`', () => {
        expect('- [ ] empty `[]` token'.match(PROJECT_TOKEN_RE)).toBeNull();
    });

    it('does NOT match a name with a space', () => {
        expect('- [ ] spaced `[has space]` token'.match(PROJECT_TOKEN_RE)).toBeNull();
    });
});

describe('PROJECT_TOKEN_RE_G', () => {
    it('finds both tokens on a two-token line', () => {
        const line = '- [ ] double `[alpha]` and `[beta]` here';
        const matches = [...line.matchAll(PROJECT_TOKEN_RE_G)];
        expect(matches.map(m => m[1])).toEqual(['alpha', 'beta']);
    });
});
