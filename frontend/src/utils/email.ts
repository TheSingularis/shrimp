/** Shared email display helpers used across EmailPanel, EmailDetail, DashboardHome. */

export function senderName(from: string | null | undefined): string {
    if (!from) return "";
    const m = from.match(/^([^<]+)</);
    if (m) return m[1].trim().replace(/^["']|["']$/g, "");
    return from.split("@")[0] || from;
}

/** Relative time like email clients: "2:45 PM" (today), "Yesterday", "Mon" (last 6 days), or "Apr 15" (older) */
export function relativeTime(iso: string | null | undefined): string {
    if (!iso) return "";
    const d = new Date(iso);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dateOnly = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const daysDiff = Math.floor((today.getTime() - dateOnly.getTime()) / (1000 * 60 * 60 * 24));

    // Same day: show time
    if (daysDiff === 0) {
        return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    }

    // Yesterday
    if (daysDiff === 1) {
        return "Yesterday";
    }

    // Last 6 days: show day of week
    if (daysDiff <= 6) {
        return d.toLocaleDateString(undefined, { weekday: "short" });
    }

    // Older: show date
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Today → time only; older → "Apr 15" style */
export function formatDate(iso: string | null | undefined): string {
    if (!iso) return "";
    const d = new Date(iso);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
        return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    }
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Full datetime: "Thu, Apr 15, 2026, 09:15 AM" */
export function formatDateFull(iso: string | null | undefined): string {
    if (!iso) return "";
    return new Date(iso).toLocaleString(undefined, {
        weekday: "short", year: "numeric", month: "short",
        day: "numeric", hour: "2-digit", minute: "2-digit",
    });
}
