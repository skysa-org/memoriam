/**
 * The Web Lock a sync of the library runs under (the kit's scheduler), so that
 * one tab syncs it at a time. Web Locks are the origin's own, so the name has
 * only this app's tabs to agree with — but those include a tab still running
 * an older build, which takes the lock by the name that build had: a different
 * name here and the two would sync the library at once. It is the scheduler's
 * to be given rather than its own to choose, so that the scheduler names no
 * app (skysa-notes' record 0018).
 */
export const SYNC_LOCK = (connectionId: string): string => `memoriam:sync:${connectionId}`;
