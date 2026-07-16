import { RegisteredFocusDimension } from '../../vscode/focus-dimension';
import { userFocus } from './focus-user';
import { tagFocus } from './focus-tag';
import { projectFocus } from './focus-project';
import { activityFocus } from './focus-activity';

/**
 * Every focus dimension, in activation-registration order (user, tag,
 * project, activity — the pre-3d init order in extension.ts). On-screen
 * status-bar order comes from the frozen per-descriptor priorities, not this
 * array. activate(), clearAllFocus, and the editor-event status-bar
 * refreshes iterate this registry — adding a fifth dimension means writing a
 * descriptor module and adding one entry here.
 */
export const focusDimensions: readonly RegisteredFocusDimension[] = [
    userFocus,
    tagFocus,
    projectFocus,
    activityFocus,
];
