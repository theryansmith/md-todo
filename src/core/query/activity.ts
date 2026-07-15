import { TodoItem, ProjectDefinition, ActivityFocus } from '../model';
import { parseDate, daysBetween, isDateInRange } from '../dates';

/**
 * Resolve the project an item belongs to: its own `[name]` token if present,
 * otherwise the nearest ancestor's. Children inherit the enclosing project
 * unless they carry their own token.
 */
export function getEffectiveProject(item: TodoItem): string | undefined {
    let cur: TodoItem | undefined = item;
    while (cur) {
        if (cur.project) {
            return cur.project;
        }
        cur = cur.parent;
    }
    return undefined;
}

export function isDefinedProject(name: string, projectDefinitions: ProjectDefinition[]): boolean {
    return projectDefinitions.some((p) => p.name === name);
}

export function itemMatchesActivity(item: TodoItem, activity: ActivityFocus, today: Date): boolean {
    if (activity.kind === 'completed') {
        if (!item.completedDate) {
            return false;
        }
        const d = parseDate(item.completedDate);
        if (!d) {
            return false;
        }
        return isDateInRange(d, activity.startDate!, activity.endDate!);
    }
    if (activity.kind === 'added') {
        if (!item.addedDate) {
            return false;
        }
        const d = parseDate(item.addedDate);
        if (!d) {
            return false;
        }
        return isDateInRange(d, activity.startDate!, activity.endDate!);
    }
    if (item.isComplete || !item.addedDate) {
        return false;
    }
    const d = parseDate(item.addedDate);
    if (!d) {
        return false;
    }
    return daysBetween(today, d) >= (activity.staleDays ?? 0);
}
