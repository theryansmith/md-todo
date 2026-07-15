import { FocusDimension } from '../../vscode/focus-dimension';
import { FOCUS_TAG_STATE_KEY } from '../../vscode/workspace-state';
import { repaintDimInVisibleTodoEditors } from './decoration-dim';

/**
 * The tag focus dimension (`#tag`). All generic behavior lives in
 * vscode/focus-dimension.ts; this module carries only what the Phase 3d
 * divergence audit (TDD Appendix B) found to differ.
 */
export const tagFocus = new FocusDimension<string>({
    id: 'tag',
    stateKey: FOCUS_TAG_STATE_KEY,
    statusBar: {
        // Priority 99 so user-focus at 100 sits to its left (row B2).
        priority: 99,
        command: 'mdTodo.setFocusTag',
        unsetText: '$(tag) All tags',
        unsetTooltip: 'No tag focus — click to focus on a tag',
        setText: (focus) => `$(tag) #${focus}`,
        setTooltip: (focus) => `Focused on #${focus} — click to change`,
    },
    pick: {
        commandId: 'mdTodo.setFocusTag',
        clearDescription: 'Show all tags',
        noDefinitionsMessage: 'No tags defined. Add a "## Tags" section first.',
        selectPlaceholder: 'Select a tag to focus on (or clear)',
        currentPlaceholder: (current) => `Currently focused on #${current}`,
        entries: (parsed) =>
            [...parsed.tagDefinitions]
                .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
                .map((t) => ({
                    label: `$(tag) #${t.name}`,
                    detail: t.description,
                    value: t.name,
                })),
    },
    onDidChange: repaintDimInVisibleTodoEditors,
});
