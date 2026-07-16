import * as vscode from 'vscode';
import { addItem } from '../features/items/commands-add-item';
import { markDone } from '../features/items/commands-mark-done';
import { addNote } from '../features/items/commands-add-note';
import { archiveItems } from '../features/items/commands-archive';
import { quickAdd } from '../features/items/commands-quick-add';
import { showHistory } from '../features/reports/commands-history';
import { showStats } from '../features/reports/commands-stats';
import {
    showRecentlyCompleted,
    showRecentlyAdded,
    showStaleItems,
    activityFocusMenu,
} from '../features/reports/activity-reports';
import { initializeTodoFile } from '../features/initialize/commands-initialize';
import { addTags } from '../features/tags/commands-add-tags';
import { manageTags } from '../features/tags/commands-manage-tags';
import { setProject } from '../features/projects/commands-set-project';
import { manageProjects } from '../features/projects/commands-manage-projects';
import { showProjectView } from '../features/projects/project-view';
import { addUser } from '../features/users/commands-add-user';
import { assignFocusedUser } from '../features/users/commands-assign-focused-user';
import { focusDimensions } from '../features/focus';

/**
 * Declarative command registry (TDD "Key abstractions" §7): ONE table of the
 * editor/palette commands the composition root registers, looped by
 * registerCommands() below. Not in this table — by design, not omission:
 *
 * - Focus-dimension commands (mdTodo.setFocusUser/Tag/Project,
 *   mdTodo.clearActivityFocus): each FocusDimension registers its own
 *   commands from its descriptor (the 3d design); registerCommands() invokes
 *   that registration, and the dimensions export their IDs via `commandIds`.
 * - Tree context-menu commands (the mdTodo.users. / mdTodo.tags. /
 *   mdTodo.projects. groups): registered by registrations/views.ts against
 *   its providers; `treeCommandIds` there is the authoritative list.
 *
 * The package.json ↔ registration consistency test
 * (test/integration/command-registry.test.ts) asserts the union of all three
 * sources against contributes.commands, so a missing registration or an
 * orphan contribution fails CI instead of failing at runtime.
 */

type CommandHandler = Parameters<typeof vscode.commands.registerCommand>[1];
/**
 * Like registerTextEditorCommand's callback but returning `unknown` instead
 * of `void`, so async feature handlers can sit in the table without tripping
 * no-misused-promises on the property assignment (the host API accepts
 * thenable-returning callbacks by design — same rationale as the rule's
 * argument exemption). The parameter tuple is derived from the host callback
 * type itself, so extra-arg handlers (markDone's targetLine) stay assignable
 * and the rows feed registerTextEditorCommand unchanged.
 */
type TextEditorCommandHandler = (
    ...args: Parameters<Parameters<typeof vscode.commands.registerTextEditorCommand>[1]>
) => unknown;

export type CommandRegistration =
    | { id: string; kind: 'command'; handler: CommandHandler }
    | { id: string; kind: 'textEditor'; handler: TextEditorCommandHandler };

export const commandRegistry: readonly CommandRegistration[] = [
    { id: 'mdTodo.addItem', kind: 'textEditor', handler: addItem },
    { id: 'mdTodo.markDone', kind: 'textEditor', handler: markDone },
    { id: 'mdTodo.addNote', kind: 'textEditor', handler: addNote },
    { id: 'mdTodo.archive', kind: 'textEditor', handler: archiveItems },
    { id: 'mdTodo.showHistory', kind: 'textEditor', handler: showHistory },
    { id: 'mdTodo.showStats', kind: 'textEditor', handler: showStats },
    { id: 'mdTodo.quickAdd', kind: 'textEditor', handler: quickAdd },
    { id: 'mdTodo.addTags', kind: 'textEditor', handler: addTags },
    { id: 'mdTodo.manageTags', kind: 'textEditor', handler: manageTags },
    { id: 'mdTodo.setProject', kind: 'textEditor', handler: setProject },
    { id: 'mdTodo.manageProjects', kind: 'textEditor', handler: manageProjects },
    { id: 'mdTodo.showProjectView', kind: 'textEditor', handler: showProjectView },
    { id: 'mdTodo.addUser', kind: 'textEditor', handler: addUser },
    { id: 'mdTodo.initialize', kind: 'textEditor', handler: initializeTodoFile },
    { id: 'mdTodo.assignFocusedUser', kind: 'textEditor', handler: assignFocusedUser },
    { id: 'mdTodo.showRecentlyCompleted', kind: 'textEditor', handler: showRecentlyCompleted },
    { id: 'mdTodo.showRecentlyAdded', kind: 'textEditor', handler: showRecentlyAdded },
    { id: 'mdTodo.showStaleItems', kind: 'textEditor', handler: showStaleItems },
    // The activity status-bar click target; also aliased below. Deliberately
    // NOT in package.json contributes.commands (the consistency test carries
    // it on its documented exception list).
    { id: 'mdTodo.activityFocusMenu', kind: 'command', handler: activityFocusMenu },
    { id: 'mdTodo.setFocusActivity', kind: 'command', handler: activityFocusMenu },
    {
        id: 'mdTodo.clearAllFocus',
        kind: 'command',
        handler: async () => {
            // Registry order = user, tag, project, activity (the pre-3d order).
            for (const dimension of focusDimensions) {
                await dimension.clear();
            }
        },
    },
];

/**
 * Register every command surface owned by the composition root: the table
 * above, then each focus dimension's own status-bar item and commands
 * (mdTodo.setFocusUser/Tag/Project, mdTodo.clearActivityFocus).
 */
export function registerCommands(context: vscode.ExtensionContext): void {
    for (const row of commandRegistry) {
        context.subscriptions.push(
            row.kind === 'textEditor'
                ? vscode.commands.registerTextEditorCommand(row.id, row.handler)
                : vscode.commands.registerCommand(row.id, row.handler)
        );
    }

    for (const dimension of focusDimensions) {
        dimension.register(context);
    }
}
