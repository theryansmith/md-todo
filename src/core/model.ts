export interface TodoItem {
    line: number;
    text: string;
    isComplete: boolean;
    addedDate?: string;
    completedDate?: string;
    notes: string[];
    raw: string;
    indent: number;
    tags: string[];
    mentions: string[];
    /** Project from the first `[name]` token on the line, if any. */
    project?: string;
    children: TodoItem[];
    parent?: TodoItem;
}

export interface TagDefinition {
    name: string;
    description: string;
    line: number;
}

export interface UserDefinition {
    shortname: string;
    fullname: string;
    description: string;
    line: number;
}

export interface ProjectDefinition {
    name: string;
    description: string;
    line: number;
}

export interface ParsedDocument {
    items: TodoItem[];
    sections: Map<string, { start: number; end: number }>;
    tagDefinitions: TagDefinition[];
    userDefinitions: UserDefinition[];
    projectDefinitions: ProjectDefinition[];
}

export interface TagValidationResult {
    validTags: string[];
    undefinedTags: string[];
}

export type ActivityKind = 'completed' | 'added' | 'stale';

export interface ActivityFocus {
    kind: ActivityKind;
    startDate?: string;
    endDate?: string;
    staleDays?: number;
    label: string;
}
