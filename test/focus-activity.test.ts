import { describe, expect, it } from 'vitest';
import { renderCompletedItemLines } from '../focus-activity';
import { parseDocument } from '../parser';
import { makeDoc } from './helpers';

describe('renderCompletedItemLines', () => {
    it('renders the item line with added/completed timing and no parent block when top-level', () => {
        const parsed = parseDocument(makeDoc([
            '## Completed',
            '',
            '- [x] Ship it `+2026-01-01` `✓2026-01-05`',
        ].join('\n')));
        const item = parsed.items[0];
        expect(renderCompletedItemLines(item)).toEqual([
            '- Ship it — added 2026-01-01, completed in 4 days',
        ]);
    });

    it('adds a parent context line plus the parent\'s notes when the item has a parent todo', () => {
        const parsed = parseDocument(makeDoc([
            '## Completed',
            '',
            '- [x] Refactor auth module `+2026-01-25` `✓2026-01-28`',
            '  - Discussed approach with team `+2026-01-25`',
            '  - [x] Extract common logic `+2026-01-25` `✓2026-01-26`',
        ].join('\n')));
        const parent = parsed.items[0];
        const child = parent.children[0];
        expect(renderCompletedItemLines(child)).toEqual([
            '- Extract common logic — added 2026-01-25, completed in 1 days',
            '  - _Parent: Refactor auth module_',
            '    - Discussed approach with team `+2026-01-25`',
        ]);
    });

    it('adds a parent context line with no note lines when the parent has no notes', () => {
        const parsed = parseDocument(makeDoc([
            '## Completed',
            '',
            '- [x] Parent task `+2026-01-01`',
            '  - [x] Child task `+2026-01-01` `✓2026-01-02`',
        ].join('\n')));
        const child = parsed.items[0].children[0];
        expect(renderCompletedItemLines(child)).toEqual([
            '- Child task — added 2026-01-01, completed in 1 days',
            '  - _Parent: Parent task_',
        ]);
    });
});
