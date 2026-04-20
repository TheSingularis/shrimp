/** Shared email display helpers used across EmailPanel, EmailDetail, DashboardHome. */

export function senderName(from: string): string {
    const m = from.match(/^([^<]+)</);
    if (m) return m[1].trim().replace(/^["']|["']$/g, "");
    return from.split("@")[0] || from;
}

/** Relative time: "5m ago", "3h ago", "2d ago" */
export function relativeTime(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
}

/** Today → time only; older → "Apr 15" style */
export function formatDate(iso: string): string {
    const d = new Date(iso);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
        return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    }
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Full datetime: "Thu, Apr 15, 2026, 09:15 AM" */
export function formatDateFull(iso: string): string {
    return new Date(iso).toLocaleString(undefined, {
        weekday: "short", year: "numeric", month: "short",
        day: "numeric", hour: "2-digit", minute: "2-digit",
    });
}
