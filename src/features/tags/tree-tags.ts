import * as vscode from 'vscode';
import { TagDefinition } from '../../core/model';
import {
    GroupingDescriptor,
    GroupingTreeNode,
    GroupingTreeProvider,
} from '../../vscode/grouping-tree';
import { setFocusTagState } from '../../vscode/state';
import { refreshFocusTagStatusBar } from '../focus/focus-tag';
import { clearFocusFromTree, focusFromTreeRoot, runCommandAtTreeTodo } from '../tree-commands';

/**
 * The Tags tree: one root per `## Tags` definition, grouped by #tag.
 * All generic behavior lives in vscode/grouping-tree.ts; this module carries
 * only what the Phase 3c divergence audit (TDD Appendix A) found to differ.
 */
export const tagsGrouping: GroupingDescriptor<TagDefinition> = {
    id: 'tags',
    definitionsOf: (parsed) => parsed.tagDefinitions,
    keysOf: (item) => item.tags,
    keyOf: (tag) => tag.name,
    labelOf: (tag) => `#${tag.name}`,
    rootTooltipHeaderOf: (tag) => `#${tag.name} — ${tag.description}`,
    rootIconOf: () => 'tag',
    unassignedLabel: 'Untagged',
    unassignedIcon: 'circle-slash',
    unassignedTooltipHeader: 'Todos with no #tag',
    contextValues: {
        root: 'tag-root',
        unassigned: 'untagged',
        section: 'tag-section',
        todo: 'tag-todo',
    },
};

export type TagsTreeNode = GroupingTreeNode<TagDefinition>;

/** Compatibility shim over the generic provider; removed when views.ts iterates descriptors. */
export class MdTodoTagsTreeProvider extends GroupingTreeProvider<TagDefinition> {
    constructor(workspaceState: vscode.Memento) {
        super(tagsGrouping, workspaceState);
    }
}

export async function focusOnTagFromTree(node?: TagsTreeNode): Promise<void> {
    await focusFromTreeRoot(
        node,
        tagsGrouping.keyOf,
        'Right-click a tag in the MD Todo Tags view.',
        setFocusTagState,
        refreshFocusTagStatusBar
    );
}

export async function clearTagFocusFromTree(): Promise<void> {
    await clearFocusFromTree(setFocusTagState, refreshFocusTagStatusBar);
}

export { markDoneFromTreeNode as markDoneFromTagsTree } from '../tree-commands';

export async function editTagsFromTree(node?: TagsTreeNode): Promise<void> {
    await runCommandAtTreeTodo(node, 'mdTodo.addTags');
}
