import * as vscode from 'vscode';
import { UserDefinition } from '../../core/model';
import {
    GroupingDescriptor,
    GroupingTreeNode,
    GroupingTreeProvider,
} from '../../vscode/grouping-tree';
import { parseDocument } from '../../vscode/document-cache';
import { userFocus } from '../focus/focus-user';
import { clearFocusFromTree, focusFromTreeRoot } from '../tree-commands';

/**
 * The Users tree: one root per `## Users` definition, grouped by @mention.
 * All generic behavior lives in vscode/grouping-tree.ts; this module carries
 * only what the Phase 3c divergence audit (TDD Appendix A) found to differ.
 */
export const usersGrouping: GroupingDescriptor<UserDefinition> = {
    id: 'users',
    definitionsOf: (parsed) => parsed.userDefinitions,
    keysOf: (item) => item.mentions,
    keyOf: (user) => user.shortname,
    labelOf: (user) => user.fullname,
    rootDescriptionOf: (user, counts) => `@${user.shortname}  (${counts.active} active)`,
    rootTooltipHeaderOf: (user) => `${user.fullname} — ${user.description}`,
    rootIconOf: () => 'person',
    unassignedLabel: 'Unassigned',
    unassignedIcon: 'person-add',
    unassignedTooltipHeader: 'Todos with no @mention',
    contextValues: { root: 'user', unassigned: 'unassigned', section: 'section', todo: 'todo' },
};

export type UsersTreeNode = GroupingTreeNode<UserDefinition>;

export async function focusOnUserFromTree(node?: UsersTreeNode): Promise<void> {
    await focusFromTreeRoot(
        node,
        usersGrouping.keyOf,
        'Right-click a user in the MD Todo Users view.',
        (value) => userFocus.setState(value),
        (editor) => {
            userFocus.refreshStatusBar(editor);
        }
    );
}

export async function clearUserFocusFromTree(): Promise<void> {
    await clearFocusFromTree(
        (value) => userFocus.setState(value),
        (editor) => {
            userFocus.refreshStatusBar(editor);
        }
    );
}

export async function reassignUserFromTree(
    treeProvider: GroupingTreeProvider<UserDefinition>,
    node?: UsersTreeNode
): Promise<void> {
    if (node?.kind !== 'todo') {
        return;
    }

    const uri = treeProvider.getCurrentUri();
    if (!uri) {
        return;
    }

    const doc = await vscode.workspace.openTextDocument(uri);
    const parsed = parseDocument(doc);

    if (parsed.userDefinitions.length === 0) {
        vscode.window.showInformationMessage('No users defined. Add a ## Users section first.');
        return;
    }

    const picks = parsed.userDefinitions.map((u) => ({
        label: `@${u.shortname}`,
        description: u.fullname,
        detail: u.description,
        user: u,
    }));

    const selected = await vscode.window.showQuickPick(picks, {
        placeHolder: `Reassign: ${node.item.text}`,
        matchOnDescription: true,
        matchOnDetail: true,
    });
    if (!selected) {
        return;
    }

    // Design choice: if the line already has any @mention, replace the FIRST mention.
    // If none, append the @mention to the end of the line (before any trailing whitespace).
    const editor = await vscode.window.showTextDocument(doc);
    const line = doc.lineAt(node.item.line);
    let newText = line.text;
    const mentionRe = /@[\w-]+/;

    if (mentionRe.test(newText)) {
        newText = newText.replace(mentionRe, `@${selected.user.shortname}`);
    } else {
        newText = newText.replace(/\s*$/, '') + ` @${selected.user.shortname}`;
    }

    await editor.edit((eb) => {
        eb.replace(line.range, newText);
    });
    treeProvider.refresh();
}
