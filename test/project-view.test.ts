import { describe, expect, it } from 'vitest';
import { filterItemsForProject, renderProjectView } from '../project-view';
import { parseDocument } from '../parser';
import { makeDoc } from './helpers';

const SAMPLE = [
    '## Active',
    '',
    '- [ ] Ship feature `[game-x]`',
    '  - Planning note',
    '  - [ ] Write tests',
    '    - [ ] Sub task `[tools]`',
    '- [ ] Unrelated task',
    '- [ ] Nested under other `[misc]`',
    '  - [ ] Sub for game-x `[game-x]`',
    '',
    '## Completed',
    '',
    '- [x] Old finished `[game-x]` `+2026-01-01` `✓2026-01-05`',
    '',
    '## Projects',
    '',
    '**game-x**: The big title',
    '**tools**: Internal tooling',
    '**misc**: Misc bucket',
].join('\n');

describe('filterItemsForProject', () => {
    it('includes direct matches, inherited children, and pruned-in ancestors for deep matches', () => {
        const parsed = parseDocument(makeDoc(SAMPLE));
        const roots = filterItemsForProject(parsed.items, 'game-x');

        expect(roots.map((r) => r.item.text)).toEqual([
            'Ship feature',
            'Nested under other',
            'Old finished',
        ]);

        const shipFeature = roots[0];
        expect(shipFeature.matchesProject).toBe(true);
        expect(shipFeature.children).toHaveLength(1);
        expect(shipFeature.children[0].item.text).toBe('Write tests');
        expect(shipFeature.children[0].matchesProject).toBe(true);
        // The [tools]-tagged sub task doesn't match game-x and has no matching descendants of its own.
        expect(shipFeature.children[0].children).toHaveLength(0);

        const nestedUnderOther = roots[1];
        expect(nestedUnderOther.matchesProject).toBe(false);
        expect(nestedUnderOther.children).toHaveLength(1);
        expect(nestedUnderOther.children[0].item.text).toBe('Sub for game-x');
        expect(nestedUnderOther.children[0].matchesProject).toBe(true);
    });

    it('returns nothing for a project name that matches no items', () => {
        const parsed = parseDocument(makeDoc(SAMPLE));
        expect(filterItemsForProject(parsed.items, 'nonexistent')).toEqual([]);
    });
});

describe('renderProjectView', () => {
    it('renders hierarchy, section headers, counts, notes, and a context marker for non-matching ancestors', () => {
        const parsed = parseDocument(makeDoc(SAMPLE));
        const project = parsed.projectDefinitions.find((p) => p.name === 'game-x')!;
        const output = renderProjectView(parsed, project);

        expect(output).toContain('# 📁 Project View — game-x');
        expect(output).toContain('The big title');
        expect(output).toContain('## Active (3)');
        expect(output).toContain('## Completed (1)');
        expect(output).not.toContain('## Archive');
        expect(output).toContain('**Total:** 4 items in [game-x]');

        expect(output).toContain('- [ ] Ship feature');
        expect(output).toContain('  - Planning note');
        expect(output).toContain('  - [ ] Write tests');
        expect(output).toContain('- [ ] Nested under other _(context)_');
        expect(output).toContain('  - [ ] Sub for game-x');
        expect(output).toContain('- [x] Old finished `+2026-01-01` `✓2026-01-05`');
    });

    it('reports zero items for a project with no matches', () => {
        const parsed = parseDocument(makeDoc(SAMPLE));
        const output = renderProjectView(parsed, {
            name: 'ghost',
            description: 'not used',
            line: -1,
        });
        expect(output).toContain('**Total:** 0 items in [ghost]');
        expect(output).toContain('_(no items in this project)_');
    });
});
