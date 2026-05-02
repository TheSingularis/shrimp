import { describe, it, expect } from "vitest";
import { toUrgencyLevel } from "./urgency";

describe("toUrgencyLevel", () => {
    it.each(["urgent", "high", "normal", "low", "spam"] as const)(
        "returns '%s' unchanged",
        (level) => expect(toUrgencyLevel(level)).toBe(level)
    );

    it("returns 'normal' for unknown string", () => {
        expect(toUrgencyLevel("critical")).toBe("normal");
    });

    it("returns 'normal' for undefined", () => {
        expect(toUrgencyLevel(undefined)).toBe("normal");
    });

    it("returns 'normal' for empty string", () => {
        expect(toUrgencyLevel("")).toBe("normal");
    });
});
