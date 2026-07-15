import { UserDefinition, TagDefinition, ProjectDefinition } from '../core/model';
import { GroupingTreeNode } from '../vscode/grouping-tree';

// Compatibility aliases: the three hand-written node unions collapsed into
// instances of the generic GroupingTreeNode when Phase 3c landed (the audit
// showed them isomorphic modulo `kind` strings). This file goes away when
// registrations/views.ts switches to the feature-module aliases.

export type TreeNode = GroupingTreeNode<UserDefinition>;
export type TagsTreeNode = GroupingTreeNode<TagDefinition>;
export type ProjectsTreeNode = GroupingTreeNode<ProjectDefinition>;
