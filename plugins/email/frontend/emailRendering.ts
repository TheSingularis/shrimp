export interface TriageParsed {
    urgency: string;
    summary: string;
    actions: string[];
    reply: string;
}

export function parseTriage(raw: string): TriageParsed {
    const result: TriageParsed = { urgency: "", summary: "", actions: [], reply: "" };
    let section = "";
    const replyLines: string[] = [];

    for (const line of raw.split("\n")) {
        const t = line.trim();
        if (!t) {
            if (section === "reply") replyLines.push("");
            continue;
        }

        if (/\*\*urgency\*\*/i.test(t)) {
            section = "urgency";
            const m = t.match(/\*\*urgency\*\*[:\s]+(.+)/i);
            if (m) result.urgency = m[1].replace(/\*\*/g, "").trim().toLowerCase();
        } else if (/\*\*summary\*\*/i.test(t)) {
            section = "summary";
            const m = t.match(/\*\*summary\*\*[:\s]+(.+)/i);
            if (m) result.summary = m[1].replace(/\*\*/g, "").trim();
        } else if (/\*\*action items?\*\*/i.test(t)) {
            section = "actions";
        } else if (/\*\*suggested reply\*\*/i.test(t)) {
            section = "reply";
            const m = t.match(/\*\*suggested reply\*\*[:\s]*(.+)?/i);
            if (m?.[1]) replyLines.push(m[1].replace(/^["']|["']$/g, "").trim());
        } else {
            if (section === "actions" && /^[-*•]/.test(t)) {
                result.actions.push(t.replace(/^[-*•]\s*/, "").trim());
            } else if (section === "summary" && !result.summary) {
                result.summary = t;
            } else if (section === "reply") {
                replyLines.push(t.replace(/^["']|["']$/g, "").trim());
            }
        }
    }
    result.reply = replyLines.join("\n").trim();
    return result;
}

export function looksLikeHtml(text: string): boolean {
    const sample = text.slice(0, 2000).toLowerCase().trimStart();
    if (sample.startsWith("<!doctype html") || /^<html[\s>]/.test(sample)) return true;
    const tags = ["<body", "<div>", "<div ", "<p>", "<p ", "<table", "<td", "<tr",
                  "<span>", "<span ", "<br>", "<br/", "<a ", "<img "];
    return tags.filter(t => sample.includes(t)).length >= 2;
}

type EmailViewable = { body?: string; html_body?: string; has_genuine_plain?: boolean };

export function preferredView(e: EmailViewable): "html" | "plain" {
    if (!e.html_body && !looksLikeHtml(e.body || "")) return "plain";
    if (e.has_genuine_plain) return "plain";
    return "html";
}
