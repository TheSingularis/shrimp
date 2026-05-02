import { describe, it, expect } from "vitest";
import { looksLikeHtml, preferredView, parseTriage } from "./emailRendering";

// ── looksLikeHtml ─────────────────────────────────────────────────────────────

describe("looksLikeHtml", () => {
    it("returns false for plain text", () => {
        expect(looksLikeHtml("Hello, just a plain message.")).toBe(false);
    });

    it("returns true for <!DOCTYPE html", () => {
        expect(looksLikeHtml("<!DOCTYPE html><html><body>hi</body></html>")).toBe(true);
    });

    it("returns true for <html> tag at start", () => {
        expect(looksLikeHtml("<html><body>content</body></html>")).toBe(true);
    });

    it("returns true when 2+ known tags present", () => {
        expect(looksLikeHtml("<div><p>Hello world</p></div>")).toBe(true);
    });

    it("returns false for single tag (below threshold)", () => {
        expect(looksLikeHtml("Just one <div> here")).toBe(false);
    });

    it("returns false for empty string", () => {
        expect(looksLikeHtml("")).toBe(false);
    });

    it("returns false for code-like text with angle brackets", () => {
        expect(looksLikeHtml("Use T<E> in generic programming, not <T> syntax")).toBe(false);
    });

    it("is case-insensitive for doctype", () => {
        expect(looksLikeHtml("<!doctype html>\n<html>")).toBe(true);
    });
});

// ── preferredView ─────────────────────────────────────────────────────────────

describe("preferredView", () => {
    it("returns 'plain' when no html and plain text body", () => {
        expect(preferredView({ body: "Hello plain", html_body: undefined })).toBe("plain");
    });

    it("returns 'html' for html-only email (no genuine plain)", () => {
        expect(preferredView({
            body: "stripped fallback",
            html_body: "<p>Hello</p>",
            has_genuine_plain: false,
        })).toBe("html");
    });

    it("returns 'plain' when genuine plain part exists alongside html", () => {
        expect(preferredView({
            body: "Hello in plain",
            html_body: "<p>Hello in HTML</p>",
            has_genuine_plain: true,
        })).toBe("plain");
    });

    it("returns 'html' when body looks like html and no genuine plain", () => {
        expect(preferredView({
            body: "<div><p>Inline html body</p></div>",
            html_body: undefined,
            has_genuine_plain: false,
        })).toBe("html");
    });

    it("returns 'plain' when has_genuine_plain is undefined (old cached email with html)", () => {
        // Undefined has_genuine_plain → falsy → shows html if html_body present
        expect(preferredView({ body: "text", html_body: "<p>hi</p>" })).toBe("html");
    });

    it("returns 'plain' with no html and no body", () => {
        expect(preferredView({ body: "", html_body: undefined })).toBe("plain");
    });
});

// ── parseTriage ───────────────────────────────────────────────────────────────

// The regex matches **header** (closing ** before the colon), not **header:**
const FULL_TRIAGE = `**Urgency**: High
**Summary**: Follow-up needed on the contract renewal deadline approaching next Friday.
**Action Items**:
- Review contract terms
- Schedule call with legal team
- Send confirmation to client
**Suggested Reply**: Thanks for the reminder, I'll review and get back to you by EOD.`;

describe("parseTriage", () => {
    it("parses urgency", () => {
        const result = parseTriage(FULL_TRIAGE);
        expect(result.urgency).toBe("high");
    });

    it("parses summary from inline position", () => {
        const result = parseTriage(FULL_TRIAGE);
        expect(result.summary).toContain("contract renewal");
    });

    it("parses action items as array", () => {
        const result = parseTriage(FULL_TRIAGE);
        expect(result.actions).toHaveLength(3);
        expect(result.actions[0]).toBe("Review contract terms");
        expect(result.actions[1]).toBe("Schedule call with legal team");
    });

    it("parses suggested reply", () => {
        const result = parseTriage(FULL_TRIAGE);
        expect(result.reply).toContain("EOD");
    });

    it("returns empty defaults for empty input", () => {
        const result = parseTriage("");
        expect(result).toEqual({ urgency: "", summary: "", actions: [], reply: "" });
    });

    it("recognises 'urgent' urgency level", () => {
        const result = parseTriage("**Urgency**: urgent");
        expect(result.urgency).toBe("urgent");
    });

    it("recognises 'spam' urgency level", () => {
        const result = parseTriage("**Urgency**: Spam");
        expect(result.urgency).toBe("spam");
    });

    it("handles bullet variants (*, •)", () => {
        const text = `**Action Items**:\n* First action\n• Second action`;
        const result = parseTriage(text);
        expect(result.actions).toHaveLength(2);
        expect(result.actions[0]).toBe("First action");
    });

    it("is case-insensitive for section headers", () => {
        const text = `**URGENCY**: Low\n**SUMMARY**: Nothing urgent`;
        const result = parseTriage(text);
        expect(result.urgency).toBe("low");
        expect(result.summary).toContain("Nothing urgent");
    });

    it("bullet stripping works for dash-prefixed actions", () => {
        const text = `**Action Items**:\n- Do the thing`;
        expect(parseTriage(text).actions[0]).toBe("Do the thing");
    });
});
