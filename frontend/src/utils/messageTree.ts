import { type Message } from "../api";

/**
 * Get messages in current branch (follows activePath).
 * Returns messages in chronological order.
 */
export function getActiveBranch(
    messages: Message[],
    activePath: string[]
): Message[] {
    if (activePath.length === 0) return [];

    const messageMap = new Map(messages.map(m => [m.id, m]));
    const branch: Message[] = [];

    for (const id of activePath) {
        const msg = messageMap.get(id);
        if (msg) branch.push(msg);
    }

    return branch;
}

/**
 * Get all children of a message.
 */
export function getChildren(
    messages: Message[],
    parentId: string | null
): Message[] {
    return messages.filter(m => m.parentId === parentId);
}

/**
 * Get siblings (other branches from same parent).
 * Includes the message itself.
 */
export function getSiblings(
    messages: Message[],
    messageId: string
): Message[] {
    const msg = messages.find(m => m.id === messageId);
    if (!msg) return [];

    return messages.filter(m => m.parentId === msg.parentId);
}

/**
 * Build active path from root to message.
 * Returns array of message IDs in order from root to target.
 */
export function buildPathToMessage(
    messages: Message[],
    targetId: string
): string[] {
    const messageMap = new Map(messages.map(m => [m.id, m]));
    const path: string[] = [];

    let current = messageMap.get(targetId);
    while (current) {
        path.unshift(current.id);
        if (current.parentId === null) break;
        current = messageMap.get(current.parentId);
    }

    return path;
}

/**
 * Add new message to tree.
 */
export function addMessage(
    messages: Message[],
    newMessage: Message
): Message[] {
    return [...messages, newMessage];
}

/**
 * Find message by ID.
 */
export function findMessage(
    messages: Message[],
    messageId: string
): Message | undefined {
    return messages.find(m => m.id === messageId);
}

/**
 * Get the current branch index and total branches for a message.
 * Used for branch navigation UI (e.g., "2 / 3").
 */
export function getBranchInfo(
    messages: Message[],
    activePath: string[],
    messageId: string
): { currentIndex: number; totalBranches: number } {
    const siblings = getSiblings(messages, messageId);
    const currentIndex = siblings.findIndex(s => s.id === messageId);

    return {
        currentIndex: currentIndex === -1 ? 0 : currentIndex,
        totalBranches: siblings.length
    };
}

/**
 * Navigate to previous sibling branch.
 * Returns new activePath.
 */
export function navigateToPreviousBranch(
    messages: Message[],
    activePath: string[],
    messageId: string
): string[] {
    const siblings = getSiblings(messages, messageId);
    if (siblings.length <= 1) return activePath;

    const currentIdx = siblings.findIndex(s => s.id === messageId);
    const prevIdx = (currentIdx - 1 + siblings.length) % siblings.length;
    const prevSibling = siblings[prevIdx];

    return buildPathToMessage(messages, prevSibling.id);
}

/**
 * Navigate to next sibling branch.
 * Returns new activePath.
 */
export function navigateToNextBranch(
    messages: Message[],
    activePath: string[],
    messageId: string
): string[] {
    const siblings = getSiblings(messages, messageId);
    if (siblings.length <= 1) return activePath;

    const currentIdx = siblings.findIndex(s => s.id === messageId);
    const nextIdx = (currentIdx + 1) % siblings.length;
    const nextSibling = siblings[nextIdx];

    return buildPathToMessage(messages, nextSibling.id);
}
