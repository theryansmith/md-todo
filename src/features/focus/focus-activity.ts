import { ActivityFocus } from '../../core/model';
import { FocusDimension } from '../../vscode/focus-dimension';
import { ACTIVITY_FOCUS_STATE_KEY } from '../../vscode/state';
import { repaintDimInVisibleTodoEditors } from './decoration-dim';

function prefixOf(focus: ActivityFocus): string {
    return focus.kind === 'completed' ? 'Completed' : focus.kind === 'added' ? 'Added' : 'Stale';
}

/**
 * The activity focus dimension (date/staleness filter). Unlike
 * user/tag/project it has no definitions pick: the status-bar click opens
 * the activity command menu, and focus values are written by the report
 * commands via `activityFocus.set()` — both live in
 * features/reports/activity-reports.ts. The dedicated clear command is
 * registered here (TDD Appendix B rows B3/B9/B13).
 */
export const activityFocus = new FocusDimension<ActivityFocus>({
    id: 'activity',
    stateKey: ACTIVITY_FOCUS_STATE_KEY,
    clearCommandId: 'mdTodo.clearActivityFocus',
    statusBar: {
        // Priority 98, between tag-focus (99) and project-focus (97) (row B2).
        priority: 98,
        command: 'mdTodo.activityFocusMenu',
        unsetText: '$(calendar) All time',
        unsetTooltip: 'No activity focus — click to filter by date',
        setText: (focus) => `$(calendar) ${prefixOf(focus)}: ${focus.label}`,
        setTooltip: (focus) =>
            `Activity focus: ${prefixOf(focus)} (${focus.label}) — click to change`,
    },
    onDidChange: repaintDimInVisibleTodoEditors,
});
