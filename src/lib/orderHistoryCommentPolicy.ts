/**
 * Pipeline status IDs for which `history_comment` must be non-empty on save.
 * Supplied as package-milestone UUIDs; wired to `order_status_id` in order edit / bulk flows.
 */
const STATUSES_REQUIRING_HISTORY_COMMENT = new Set<string>([
    '4d622f19-cf11-4d31-b908-5829ce0c57c7',
    'b5b9f007-dee5-4873-9424-70cfd9231368',
    '713cf400-b800-4bea-b27a-8c40241e0ae2',
]);

export function statusRequiresHistoryComment(statusId: string | null | undefined): boolean {
    return !!statusId && STATUSES_REQUIRING_HISTORY_COMMENT.has(statusId);
}
