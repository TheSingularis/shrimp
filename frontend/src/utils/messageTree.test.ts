import { describe, it, expect } from "vitest";
import {
    getActiveBranch, getChildren, getSiblings,
    buildPathToMessage, addMessage, findMessage,
    getBranchInfo, navigateToPreviousBranch, navigateToNextBranch,
} from "./messageTree";
import type { Message } from "../api";

function msg(id: string, parentId: string | null = null): Message {
    return { id, role: "user", content: "", parentId, createdAt: "" };
}

// Linear chain: root → A → B
const LINEAR = [msg("root"), msg("A", "root"), msg("B", "A")];

// Tree with branches: root → A → B
//                              ↘ C
const BRANCHED = [msg("root"), msg("A", "root"), msg("B", "A"), msg("C", "A")];

// ── getActiveBranch ───────────────────────────────────────────────────────────

describe("getActiveBranch", () => {
    it("returns messages in path order", () => {
        const result = getActiveBranch(LINEAR, ["root", "A", "B"]);
        expect(result.map(m => m.id)).toEqual(["root", "A", "B"]);
    });

    it("returns empty array for empty path", () => {
        expect(getActiveBranch(LINEAR, [])).toEqual([]);
    });

    it("skips ids not in message list", () => {
        const result = getActiveBranch(LINEAR, ["root", "MISSING", "B"]);
        expect(result.map(m => m.id)).toEqual(["root", "B"]);
    });
});

// ── getChildren ───────────────────────────────────────────────────────────────

describe("getChildren", () => {
    it("gets children of a node", () => {
        const children = getChildren(BRANCHED, "A");
        expect(children.map(m => m.id).sort()).toEqual(["B", "C"]);
    });

    it("gets root-level messages (parentId = null)", () => {
        const roots = getChildren(BRANCHED, null);
        expect(roots.map(m => m.id)).toEqual(["root"]);
    });

    it("returns empty for leaf node", () => {
        expect(getChildren(LINEAR, "B")).toEqual([]);
    });
});

// ── getSiblings ───────────────────────────────────────────────────────────────

describe("getSiblings", () => {
    it("returns all siblings including self", () => {
        const siblings = getSiblings(BRANCHED, "B");
        expect(siblings.map(m => m.id).sort()).toEqual(["B", "C"]);
    });

    it("returns just self when no siblings", () => {
        const siblings = getSiblings(LINEAR, "A");
        expect(siblings.map(m => m.id)).toEqual(["A"]);
    });

    it("returns empty for unknown id", () => {
        expect(getSiblings(LINEAR, "MISSING")).toEqual([]);
    });
});

// ── buildPathToMessage ────────────────────────────────────────────────────────

describe("buildPathToMessage", () => {
    it("builds full path from root to target", () => {
        expect(buildPathToMessage(LINEAR, "B")).toEqual(["root", "A", "B"]);
    });

    it("returns single id for root node", () => {
        expect(buildPathToMessage(LINEAR, "root")).toEqual(["root"]);
    });

    it("returns empty for unknown id", () => {
        expect(buildPathToMessage(LINEAR, "MISSING")).toEqual([]);
    });

    it("builds correct path in branched tree", () => {
        expect(buildPathToMessage(BRANCHED, "C")).toEqual(["root", "A", "C"]);
    });
});

// ── addMessage ────────────────────────────────────────────────────────────────

describe("addMessage", () => {
    it("appends message to array", () => {
        const result = addMessage(LINEAR, msg("D", "B"));
        expect(result).toHaveLength(4);
        expect(result[3].id).toBe("D");
    });

    it("does not mutate original array", () => {
        addMessage(LINEAR, msg("D", "B"));
        expect(LINEAR).toHaveLength(3);
    });
});

// ── findMessage ───────────────────────────────────────────────────────────────

describe("findMessage", () => {
    it("finds existing message", () => {
        expect(findMessage(LINEAR, "A")?.id).toBe("A");
    });

    it("returns undefined for missing id", () => {
        expect(findMessage(LINEAR, "MISSING")).toBeUndefined();
    });
});

// ── getBranchInfo ─────────────────────────────────────────────────────────────

describe("getBranchInfo", () => {
    it("returns index 0 and count 1 for only child", () => {
        const info = getBranchInfo(LINEAR, ["root", "A"], "A");
        expect(info.totalBranches).toBe(1);
        expect(info.currentIndex).toBe(0);
    });

    it("returns correct index for second of two siblings", () => {
        const info = getBranchInfo(BRANCHED, ["root", "A", "C"], "C");
        expect(info.totalBranches).toBe(2);
        expect(info.currentIndex).toBe(1);
    });
});

// ── navigateToPreviousBranch ──────────────────────────────────────────────────

describe("navigateToPreviousBranch", () => {
    it("stays on same path when only one sibling", () => {
        const path = ["root", "A", "B"];
        expect(navigateToPreviousBranch(LINEAR, path, "B")).toEqual(path);
    });

    it("wraps from first to last sibling", () => {
        // B is first sibling (index 0), prev should wrap to C (last)
        const result = navigateToPreviousBranch(BRANCHED, ["root", "A", "B"], "B");
        expect(result).toContain("C");
    });

    it("goes to previous sibling from last", () => {
        const result = navigateToPreviousBranch(BRANCHED, ["root", "A", "C"], "C");
        expect(result).toContain("B");
    });
});

// ── navigateToNextBranch ──────────────────────────────────────────────────────

describe("navigateToNextBranch", () => {
    it("stays on same path when only one sibling", () => {
        const path = ["root", "A", "B"];
        expect(navigateToNextBranch(LINEAR, path, "B")).toEqual(path);
    });

    it("goes to next sibling", () => {
        const result = navigateToNextBranch(BRANCHED, ["root", "A", "B"], "B");
        expect(result).toContain("C");
    });

    it("wraps from last to first sibling", () => {
        const result = navigateToNextBranch(BRANCHED, ["root", "A", "C"], "C");
        expect(result).toContain("B");
    });
});
