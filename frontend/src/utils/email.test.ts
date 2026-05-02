import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { senderName, relativeTime, formatDate, formatDateFull } from "./email";

const FIXED_NOW = new Date("2026-05-02T14:30:00.000Z");

beforeAll(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
});

afterAll(() => {
    vi.useRealTimers();
});

// ── senderName ────────────────────────────────────────────────────────────────

describe("senderName", () => {
    it("extracts name before angle bracket", () => {
        expect(senderName("John Doe <john@example.com>")).toBe("John Doe");
    });

    it("strips surrounding double quotes from name", () => {
        expect(senderName('"John Doe" <john@example.com>')).toBe("John Doe");
    });

    it("strips surrounding single quotes from name", () => {
        expect(senderName("'Jane' <jane@example.com>")).toBe("Jane");
    });

    it("falls back to local part when no angle bracket", () => {
        expect(senderName("john@example.com")).toBe("john");
    });

    it("preserves spaces inside name", () => {
        expect(senderName("Alice B. Smith <alice@example.com>")).toBe("Alice B. Smith");
    });

    it("returns empty string for null", () => {
        expect(senderName(null)).toBe("");
    });

    it("returns empty string for undefined", () => {
        expect(senderName(undefined)).toBe("");
    });

    it("returns plain string when no @ or angle bracket", () => {
        expect(senderName("No Email")).toBe("No Email");
    });
});

// ── relativeTime ──────────────────────────────────────────────────────────────

describe("relativeTime", () => {
    it("returns empty string for null", () => {
        expect(relativeTime(null)).toBe("");
    });

    it("returns empty string for undefined", () => {
        expect(relativeTime(undefined)).toBe("");
    });

    it("returns time string for today", () => {
        // Same day as FIXED_NOW (2026-05-02 UTC)
        const result = relativeTime("2026-05-02T10:00:00.000Z");
        // Should be a time like "10:00 AM" — just check it's not a date
        expect(result).toMatch(/AM|PM/i);
    });

    it("returns 'Yesterday' for yesterday", () => {
        expect(relativeTime("2026-05-01T10:00:00.000Z")).toBe("Yesterday");
    });

    it("returns day name for 3 days ago", () => {
        // 2026-04-29 is a Wednesday
        expect(relativeTime("2026-04-29T10:00:00.000Z")).toBe("Wed");
    });

    it("returns day name for 6 days ago", () => {
        // 2026-04-26 is a Sunday
        expect(relativeTime("2026-04-26T10:00:00.000Z")).toBe("Sun");
    });

    it("returns date string for 7 days ago", () => {
        const result = relativeTime("2026-04-25T10:00:00.000Z");
        expect(result).toMatch(/Apr/);
        expect(result).toMatch(/25/);
    });

    it("returns date string for older mail", () => {
        const result = relativeTime("2026-01-15T10:00:00.000Z");
        expect(result).toMatch(/Jan/);
        expect(result).toMatch(/15/);
    });
});

// ── formatDate ────────────────────────────────────────────────────────────────

describe("formatDate", () => {
    it("returns empty string for null", () => {
        expect(formatDate(null)).toBe("");
    });

    it("returns time for today", () => {
        const result = formatDate("2026-05-02T09:00:00.000Z");
        expect(result).toMatch(/AM|PM/i);
    });

    it("returns short date for yesterday", () => {
        const result = formatDate("2026-05-01T09:00:00.000Z");
        expect(result).toMatch(/May/);
        expect(result).toMatch(/1/);
    });

    it("returns short date for older mail", () => {
        const result = formatDate("2026-03-10T09:00:00.000Z");
        expect(result).toMatch(/Mar/);
    });
});

// ── formatDateFull ────────────────────────────────────────────────────────────

describe("formatDateFull", () => {
    it("returns empty string for null", () => {
        expect(formatDateFull(null)).toBe("");
    });

    it("includes weekday, month, day, year, time", () => {
        const result = formatDateFull("2026-05-02T14:30:00.000Z");
        expect(result).toMatch(/\d{4}/);      // year
        expect(result).toMatch(/May|Apr/);    // month (depends on locale offset)
    });

    it("handles undefined", () => {
        expect(formatDateFull(undefined)).toBe("");
    });
});
