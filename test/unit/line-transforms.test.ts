import { describe, expect, it } from 'vitest';
import { markLineComplete, normalizeCheckbox } from '../../src/core/edit/line-transforms';

const TODAY = '2026-07-15';

describe('normalizeCheckbox (F-16)', () => {
    it('lowercases a leading [X] checkbox', () => {
        expect(normalizeCheckbox('- [X] shout task')).toBe('- [x] shout task');
    });

    it('handles indentation and loose list-marker spacing', () => {
        expect(normalizeCheckbox('    - [X] nested')).toBe('    - [x] nested');
        expect(normalizeCheckbox('-  [X] spaced marker')).toBe('-  [x] spaced marker');
    });

    it('leaves lowercase and unchecked boxes untouched', () => {
        expect(normalizeCheckbox('- [x] fine')).toBe('- [x] fine');
        expect(normalizeCheckbox('- [ ] open')).toBe('- [ ] open');
    });

    it('normalizes only the leading checkbox, never [X] inside the text', () => {
        expect(normalizeCheckbox('- [X] see the [X] marker')).toBe('- [x] see the [X] marker');
        expect(normalizeCheckbox('prose with [X] in it')).toBe('prose with [X] in it');
        expect(normalizeCheckbox('  - note mentioning [X]')).toBe('  - note mentioning [X]');
    });
});

describe('markLineComplete', () => {
    it('checks the box and appends the ✓ date', () => {
        expect(markLineComplete('- [ ] fix login', TODAY)).toBe('- [x] fix login `✓2026-07-15`');
    });

    it('places the ✓ date right after an existing +added date', () => {
        expect(markLineComplete('- [ ] fix login `+2026-07-01`', TODAY)).toBe(
            '- [x] fix login `+2026-07-01` `✓2026-07-15`'
        );
    });

    it('normalizes a mixed-case [X] while stamping (F-16)', () => {
        expect(markLineComplete('- [X] shouty `+2026-07-01`', TODAY)).toBe(
            '- [x] shouty `+2026-07-01` `✓2026-07-15`'
        );
    });

    it('normalizes an already-completed [X] line but keeps its original ✓ date (F-16)', () => {
        expect(markLineComplete('- [X] done before `✓2026-07-01`', TODAY)).toBe(
            '- [x] done before `✓2026-07-01`'
        );
    });

    it('passes an already-completed lowercase line through unchanged', () => {
        expect(markLineComplete('- [x] done before `✓2026-07-01`', TODAY)).toBe(
            '- [x] done before `✓2026-07-01`'
        );
    });
});
