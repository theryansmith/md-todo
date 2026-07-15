import { FocusDimension } from '../../vscode/focus-dimension';
import { parseDocument } from '../../vscode/document-cache';
import { FOCUS_USER_STATE_KEY } from '../../vscode/state';
import { repaintDimInVisibleTodoEditors } from './decoration-dim';

/**
 * The user focus dimension (`@mention`). All generic behavior lives in
 * vscode/focus-dimension.ts; this module carries only what the Phase 3d
 * divergence audit (TDD Appendix B) found to differ.
 */
export const userFocus = new FocusDimension<string>({
    id: 'user',
    stateKey: FOCUS_USER_STATE_KEY,
    statusBar: {
        priority: 100,
        command: 'mdTodo.setFocusUser',
        unsetText: '$(person) All users',
        unsetTooltip: 'No user focus — click to focus on a user',
        setText: (focus) => `$(person) @${focus}`,
        // The one tooltip that reads the parse: resolve the shortname to the
        // fullname from the active document's ## Users section (row B8).
        setTooltip: (focus, document) => {
            const userDef = parseDocument(document).userDefinitions.find(
                (u) => u.shortname === focus
            );
            return `Focused on ${userDef?.fullname || focus} — click to change`;
        },
    },
    pick: {
        commandId: 'mdTodo.setFocusUser',
        clearDescription: 'Show all users',
        noDefinitionsMessage: 'No users defined. Add a "## Users" section first.',
        selectPlaceholder: 'Select a user to focus on (or clear)',
        currentPlaceholder: (current) => `Currently focused on @${current}`,
        entries: (parsed) =>
            [...parsed.userDefinitions]
                .sort((a, b) =>
                    a.shortname.localeCompare(b.shortname, undefined, { sensitivity: 'base' })
                )
                .map((u) => ({
                    label: `$(person) @${u.shortname}`,
                    description: u.fullname,
                    detail: u.description,
                    value: u.shortname,
                })),
    },
    onDidChange: repaintDimInVisibleTodoEditors,
});
