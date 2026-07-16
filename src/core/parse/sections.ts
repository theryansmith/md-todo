import { TodoItem, ParsedDocument } from '../model';

export function classifyItemSection(
    item: TodoItem,
    parsed: ParsedDocument
): 'active' | 'completed' | 'archive' | null {
    for (const [sectionName, sectionInfo] of parsed.sections) {
        if (item.line >= sectionInfo.start && item.line <= sectionInfo.end) {
            if (sectionName === 'active') {
                return 'active';
            }
            if (sectionName === 'completed') {
                return 'completed';
            }
            if (sectionName === 'archive') {
                return 'archive';
            }
            return null;
        }
    }
    return null;
}
