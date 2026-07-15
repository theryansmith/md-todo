import * as vscode from 'vscode';
import { TodoItem, ParsedDocument, ProjectDefinition } from '../../core/model';
import { GroupingDescriptor, GroupingTreeNode } from '../../vscode/grouping-tree';
import { getEffectiveProject, isDefinedProject } from '../../core/query/activity';
import { setFocusProjectState } from '../../vscode/state';
import { refreshFocusProjectStatusBar } from '../focus/focus-project';
import { clearFocusFromTree, focusFromTreeRoot, runCommandAtTreeTodo } from '../tree-commands';
import { showProjectViewForProject } from './project-view';

/**
 * Project names that are used on items (own token or inherited) but have no
 * entry in `## Projects`. These get synthetic roots in the tree so the tasks
 * carrying them are still reachable. Sorted with the same case-insensitive
 * comparator as defined projects. Pure — exported for unit tests.
 */
export function collectUndefinedProjectNames(parsed: ParsedDocument): string[] {
    const used = new Set<string>();
    function visitAll(items: TodoItem[]) {
        for (const it of items) {
            const name = getEffectiveProject(it);
            if (name && !isDefinedProject(name, parsed.projectDefinitions)) {
                used.add(name);
            }
            visitAll(it.children);
        }
    }
    visitAll(parsed.items);
    return [...used].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

/**
 * The Projects tree: one root per `## Projects` definition plus a synthetic
 * root (warning icon, `line === -1`) for each used-but-undefined name.
 * Membership uses the EFFECTIVE project — children inherit the enclosing
 * project unless they carry their own `[name]` token. All generic behavior
 * lives in vscode/grouping-tree.ts; this module carries only what the Phase
 * 3c divergence audit (TDD Appendix A) found to differ.
 */
export const projectsGrouping: GroupingDescriptor<ProjectDefinition> = {
    id: 'projects',
    definitionsOf: (parsed) => parsed.projectDefinitions,
    syntheticDefinitionsOf: (parsed) =>
        collectUndefinedProjectNames(parsed).map((name) => ({
            name,
            description: 'Not defined in ## Projects',
            line: -1,
        })),
    keysOf: (item) => {
        const name = getEffectiveProject(item);
        return name === undefined ? [] : [name];
    },
    keyOf: (project) => project.name,
    labelOf: (project) => project.name,
    rootTooltipHeaderOf: (project) => `[${project.name}] — ${project.description}`,
    // line === -1 marks a synthetic root for a used-but-undefined project
    // name (see collectUndefinedProjectNames).
    rootIconOf: (project) => (project.line === -1 ? 'warning' : 'project'),
    unassignedLabel: 'No Project',
    unassignedIcon: 'circle-slash',
    unassignedTooltipHeader: 'Todos with no [project]',
    contextValues: {
        root: 'project-root',
        unassigned: 'no-project',
        section: 'project-section',
        todo: 'project-todo',
    },
};

export type ProjectsTreeNode = GroupingTreeNode<ProjectDefinition>;

export async function focusOnProjectFromTree(node?: ProjectsTreeNode): Promise<void> {
    await focusFromTreeRoot(
        node,
        projectsGrouping.keyOf,
        'Right-click a project in the MD Todo Projects view.',
        setFocusProjectState,
        refreshFocusProjectStatusBar
    );
}

export async function clearProjectFocusFromTree(): Promise<void> {
    await clearFocusFromTree(setFocusProjectState, refreshFocusProjectStatusBar);
}

export async function showProjectViewFromTree(node?: ProjectsTreeNode): Promise<void> {
    if (node?.kind !== 'root') {
        vscode.window.showWarningMessage('Right-click a project in the MD Todo Projects view.');
        return;
    }
    await showProjectViewForProject(node.sourceUri, node.def);
}

export async function setProjectFromTree(node?: ProjectsTreeNode): Promise<void> {
    await runCommandAtTreeTodo(node, 'mdTodo.setProject');
}
