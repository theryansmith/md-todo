import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { commandRegistry } from '../../src/registrations/commands';
import { treeCommandIds } from '../../src/registrations/views';
import { focusDimensions } from '../../src/features/focus';

/**
 * package.json ↔ registration consistency (TDD "Key abstractions" §7): every
 * contributed command must be registered, and every registered command must
 * be contributed (or on the documented exception list) — so a missing
 * registration or an orphan contribution fails CI instead of failing at
 * runtime. Registration has exactly three sources:
 *
 * 1. the declarative command registry (registrations/commands.ts),
 * 2. the focus dimensions' self-registered commands (their `commandIds`),
 * 3. the tree context-menu commands (views.ts `treeCommandIds`).
 */

/**
 * Commands registered on purpose but NOT contributed in package.json — each
 * needs a reason:
 * - mdTodo.activityFocusMenu: internal click target of the activity status
 *   bar item; `mdTodo.setFocusActivity` is its contributed palette alias.
 */
const NON_CONTRIBUTED_REGISTERED = ['mdTodo.activityFocusMenu'];

interface PackageJson {
    contributes: { commands: { command: string }[] };
}

const pkg = JSON.parse(
    readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8')
) as PackageJson;

const contributedIds = pkg.contributes.commands.map((c) => c.command);

const registrySourceIds = commandRegistry.map((row) => row.id);
const focusSourceIds = focusDimensions.flatMap((dimension) => [...dimension.commandIds]);
const registeredIds = [...registrySourceIds, ...focusSourceIds, ...treeCommandIds];

describe('command registry ↔ package.json contributes.commands', () => {
    it('registers no command twice across the three sources', () => {
        const seen = new Set<string>();
        const duplicates = registeredIds.filter((id) => (seen.has(id) ? true : !seen.add(id)));
        expect(duplicates).toEqual([]);
    });

    it('contributes no command twice', () => {
        const seen = new Set<string>();
        const duplicates = contributedIds.filter((id) => (seen.has(id) ? true : !seen.add(id)));
        expect(duplicates).toEqual([]);
    });

    it('every contributed command is registered', () => {
        const registered = new Set(registeredIds);
        const unregistered = contributedIds.filter((id) => !registered.has(id));
        expect(unregistered).toEqual([]);
    });

    it('every registered command is contributed or on the documented exception list', () => {
        const contributed = new Set(contributedIds);
        const orphans = registeredIds.filter(
            (id) => !contributed.has(id) && !NON_CONTRIBUTED_REGISTERED.includes(id)
        );
        expect(orphans).toEqual([]);
    });

    it('the exception list stays honest: each entry is registered and NOT contributed', () => {
        const contributed = new Set(contributedIds);
        const registered = new Set(registeredIds);
        for (const id of NON_CONTRIBUTED_REGISTERED) {
            expect(registered.has(id), `${id} is no longer registered — drop the exception`).toBe(
                true
            );
            expect(contributed.has(id), `${id} is now contributed — drop the exception`).toBe(
                false
            );
        }
    });

    it('the focus dimensions expose exactly the frozen pick/clear command ids', () => {
        expect([...focusSourceIds].sort()).toEqual(
            [
                'mdTodo.setFocusUser',
                'mdTodo.setFocusTag',
                'mdTodo.setFocusProject',
                'mdTodo.clearActivityFocus',
            ].sort()
        );
    });
});
