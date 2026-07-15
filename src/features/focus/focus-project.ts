import { FocusDimension } from '../../vscode/focus-dimension';
import { FOCUS_PROJECT_STATE_KEY } from '../../vscode/state';
import { repaintDimInVisibleTodoEditors } from './decoration-dim';

/**
 * The project focus dimension (`[project]`). All generic behavior lives in
 * vscode/focus-dimension.ts; this module carries only what the Phase 3d
 * divergence audit (TDD Appendix B) found to differ.
 */
export const projectFocus = new FocusDimension<string>({
    id: 'project',
    stateKey: FOCUS_PROJECT_STATE_KEY,
    statusBar: {
        // Priority 97 so tag-focus at 99 and user-focus at 100 sit to its
        // left, activity at 98 directly beside it (row B2).
        priority: 97,
        command: 'mdTodo.setFocusProject',
        unsetText: '$(project) All projects',
        unsetTooltip: 'No project focus — click to focus on a project',
        setText: (focus) => `$(project) [${focus}]`,
        setTooltip: (focus) => `Focused on [${focus}] — click to change`,
    },
    pick: {
        commandId: 'mdTodo.setFocusProject',
        clearDescription: 'Show all projects',
        noDefinitionsMessage: 'No projects defined. Add a "## Projects" section first.',
        selectPlaceholder: 'Select a project to focus on (or clear)',
        currentPlaceholder: (current) => `Currently focused on [${current}]`,
        entries: (parsed) =>
            [...parsed.projectDefinitions]
                .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
                .map((p) => ({
                    label: `$(project) ${p.name}`,
                    detail: p.description,
                    value: p.name,
                })),
    },
    onDidChange: repaintDimInVisibleTodoEditors,
});
