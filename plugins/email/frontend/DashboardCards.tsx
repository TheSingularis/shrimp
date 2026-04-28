import { useState, useEffect, useRef } from "react";
import { Star, Sparkles } from "lucide-react";
import { getInbox, getFlaggedEmails, setEmailFlag, getDigest, type EmailMeta, type DigestData } from "./api";
import { triggerAutomation } from "@core/api";
import { senderName, formatDate } from "@core/utils/email";
import { PRIORITY_ORDER, UrgencyBadge, toUrgencyLevel } from "@core/utils/urgency";
import type { NavigateFn } from "@core/plugins/types";

const URGENCY_DOT: Record<string, string> = {
    urgent: "#ef4444",
    high:   "#f97316",
};

function cleanTriageNote(note: string | undefined, maxLen = 90): string | undefined {
    if (!note) return undefined;
    let clean = note.replace(/^(the email|this email)\s*/i, "").trim();
    clean = clean.charAt(0).toUpperCase() + clean.slice(1);
    return clean.length > maxLen ? clean.slice(0, maxLen - 1) + "…" : clean;
}

function isToday(iso: string): boolean {
    return new Date(iso).toDateString() === new Date().toDateString();
}

// ── Unread count hook (used by the nav badge) ─────────────────────────────────

export function useEmailUnreadCount(): number {
    const [count, setCount] = useState(0);

    useEffect(() => {
        let cancelled = false;
        async function poll() {
            try {
                const emails = await getInbox(200);
                if (!cancelled) setCount(emails.filter(e => !e.read).length);
            } catch {
                // ignore
            }
        }
        poll();
        const id = setInterval(poll, 5 * 60 * 1000);
        return () => { cancelled = true; clearInterval(id); };
    }, []);

    return count;
}

// ── Email inbox card ──────────────────────────────────────────────────────────

export function EmailDashboardCard({ onNavigate }: { onNavigate: NavigateFn }) {
    const [emails, setEmails] = useState<EmailMeta[]>([]);
    const [digest, setDigest] = useState<DigestData | null>(null);
    const [loading, setLoading] = useState(true);
    const [showSpam, setShowSpam] = useState(false);
    const [digestRefreshing, setDigestRefreshing] = useState(false);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const triageQueued = useRef(false);

    async function loadEmails() {
        try {
            const all = await getInbox(200);
            const unread = all
                .filter(e => !e.read)
                .sort((a, b) =>
                    (PRIORITY_ORDER[a.triage_priority ?? ""] ?? 5) -
                    (PRIORITY_ORDER[b.triage_priority ?? ""] ?? 5)
                );
            setEmails(unread);
            const hasUntriaged = unread.some(e => !e.triaged);
            if (hasUntriaged && !triageQueued.current) {
                triageQueued.current = true;
                triggerAutomation("email_triage").catch(() => {});
                setTimeout(() => { triageQueued.current = false; }, 5 * 60 * 1000);
            }
        } catch {
            // ignore
        }
    }

    async function loadDigest() {
        try {
            setDigest(await getDigest());
        } catch {
            // ignore
        }
    }

    useEffect(() => {
        Promise.all([loadEmails(), loadDigest()]).finally(() => setLoading(false));
        timerRef.current = setInterval(loadEmails, 5 * 60 * 1000);
        return () => { if (timerRef.current) clearInterval(timerRef.current); };
    }, []);

    async function handleDigestRefresh() {
        setDigestRefreshing(true);
        try {
            await triggerAutomation("daily_digest");
            await new Promise(r => setTimeout(r, 12000));
            await loadDigest();
        } finally {
            setDigestRefreshing(false);
        }
    }

    const visible = emails.filter(e => showSpam || e.triage_priority !== "spam").slice(0, 25);
    const spamCount = emails.filter(e => e.triage_priority === "spam").length;
    const untriaged = emails.filter(e => !e.triage_priority).length;
    const freshDigest = digest?.generated_at && isToday(digest.generated_at) ? digest : null;

    return (
        <section className="mb-6">
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>
                        Inbox
                    </h3>
                    {!loading && emails.length > 0 && (
                        <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                            {visible.length} to review
                            {untriaged > 0 && ` · ${untriaged} pending triage`}
                        </span>
                    )}
                </div>
                <button onClick={() => onNavigate("email")} className="btn-primary">
                    Open inbox
                </button>
            </div>

            {loading ? (
                <p className="text-sm py-2" style={{ color: 'var(--color-text-muted)' }}>Loading...</p>
            ) : visible.length === 0 ? (
                <div className="flex flex-col gap-1.5">
                    {!freshDigest && (
                        <div style={{
                            border: "1px solid var(--border)",
                            borderLeft: "3px solid rgba(255,255,255,0.12)",
                            borderRadius: "0 8px 8px 0",
                            padding: "10px 14px",
                            background: "var(--surface)",
                            marginBottom: 6,
                        }}>
                            <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
                                {emails.length === 0 ? "Inbox clear." : "Nothing worth reviewing right now."}
                            </p>
                        </div>
                    )}
                    {!freshDigest && (
                        <button
                            onClick={handleDigestRefresh}
                            disabled={digestRefreshing}
                            className="btn-row w-full flex items-center justify-center gap-2"
                            style={{
                                border: "1px solid var(--border)",
                                borderLeft: "3px solid var(--accent)",
                                borderRadius: "0 8px 8px 0",
                                padding: "10px 14px",
                                background: "color-mix(in srgb, var(--accent) 6%, var(--surface))",
                                color: "var(--accent)",
                                fontSize: 13,
                                marginBottom: 6,
                            }}
                        >
                            <Sparkles size={13} className={digestRefreshing ? "animate-pulse" : ""} />
                            {digestRefreshing ? "Generating..." : "Generate today's focus"}
                        </button>
                    )}
                </div>
            ) : (
                <div className="flex flex-col gap-1.5">
                    {visible.map((email) => {
                        const urgency = email.triage_priority ?? "";
                        const accentColor = URGENCY_DOT[urgency];
                        const leftBorderColor = accentColor ?? (!email.read ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.07)");
                        return (
                            <button
                                key={email.id}
                                onClick={() => onNavigate("email", email.id)}
                                className="btn-row w-full flex items-start gap-3 cursor-pointer"
                                style={{
                                    border: "1px solid var(--border)",
                                    borderLeft: `3px solid ${leftBorderColor}`,
                                    borderRadius: "0 8px 8px 0",
                                    padding: "10px 14px",
                                    background: "var(--surface)",
                                    marginBottom: 6,
                                }}
                            >
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-baseline justify-between gap-3 mb-1">
                                        <span className="text-sm font-medium truncate">{senderName(email.from)}</span>
                                        <span className="text-xs shrink-0" style={{ color: 'var(--color-text-muted)' }}>
                                            {formatDate(email.date)}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-2 justify-between mb-1">
                                        <span className="text-xs truncate" style={{ color: 'var(--color-text-muted)' }}>
                                            {email.subject}
                                        </span>
                                        {urgency && urgency !== "normal" && urgency !== "low" && (
                                            <UrgencyBadge urgency={toUrgencyLevel(urgency)} />
                                        )}
                                    </div>
                                    {cleanTriageNote(email.triage_note) ? (
                                        <p className="text-xs leading-relaxed" style={{ color: 'var(--color-text-muted)', opacity: 0.65 }}>
                                            {cleanTriageNote(email.triage_note)}
                                        </p>
                                    ) : !email.triaged ? (
                                        <p className="text-xs italic" style={{ color: 'var(--color-text-muted)', opacity: 0.4 }}>
                                            Pending triage…
                                        </p>
                                    ) : null}
                                </div>
                            </button>
                        );
                    })}

                    {spamCount > 0 && (
                        <button
                            onClick={() => setShowSpam(s => !s)}
                            className="btn-row w-full py-2 text-xs text-left hover:opacity-80 transition-opacity cursor-pointer"
                            style={{ color: 'var(--color-text-muted)' }}
                        >
                            {showSpam ? `↑ Hide ${spamCount} spam` : `${spamCount} filtered as spam — show`}
                        </button>
                    )}
                </div>
            )}
        </section>
    );
}

// ── Flagged emails card ───────────────────────────────────────────────────────

export function FlaggedDashboardCard({ onNavigate }: { onNavigate: NavigateFn }) {
    const [emails, setEmails] = useState<EmailMeta[]>([]);
    const [loading, setLoading] = useState(true);

    async function load() {
        try {
            setEmails(await getFlaggedEmails());
        } catch {
            // ignore
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => { load(); }, []);

    async function handleUnflag(id: string) {
        setEmails(prev => prev.filter(e => e.id !== id));
        try {
            await setEmailFlag(id, false);
        } catch {
            load();
        }
    }

    if (!loading && emails.length === 0) return null;

    return (
        <section className="mb-6">
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                    <Star size={12} style={{ color: '#f59e0b' }} fill="#f59e0b" />
                    <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>
                        Flagged
                    </h3>
                    {emails.length > 0 && (
                        <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{emails.length}</span>
                    )}
                </div>
            </div>

            {loading ? (
                <p className="text-sm py-2" style={{ color: 'var(--color-text-muted)' }}>Loading...</p>
            ) : (
                <div className="flex flex-col gap-1.5">
                    {emails.map((email) => {
                        const urgency = email.triage_priority ?? "";
                        const accentColor = URGENCY_DOT[urgency];
                        const leftBorderColor = accentColor ?? "#f59e0b";
                        return (
                            <div
                                key={email.id}
                                className="flex items-start"
                                style={{
                                    border: "1px solid var(--border)",
                                    borderLeft: `3px solid ${leftBorderColor}`,
                                    borderRadius: "0 8px 8px 0",
                                    background: "var(--surface)",
                                    marginBottom: 6,
                                }}
                            >
                                <button
                                    onClick={() => onNavigate("email", email.id)}
                                    className="btn-row flex-1 min-w-0 text-left"
                                    style={{ padding: "11px 10px 11px 14px" }}
                                >
                                    <div className="flex items-baseline justify-between gap-2 mb-0.5">
                                        <span className="text-sm font-medium truncate">{senderName(email.from)}</span>
                                        <span className="text-xs shrink-0" style={{ color: 'var(--color-text-muted)' }}>
                                            {formatDate(email.date)}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-2 justify-between mb-0.5">
                                        <span className="text-xs truncate" style={{ color: 'var(--color-text-muted)' }}>
                                            {email.subject}
                                        </span>
                                        {urgency && urgency !== "normal" && urgency !== "low" && (
                                            <UrgencyBadge urgency={toUrgencyLevel(urgency)} />
                                        )}
                                    </div>
                                    {cleanTriageNote(email.triage_note) && (
                                        <p className="text-xs" style={{ color: 'var(--color-text-muted)', opacity: 0.65 }}>
                                            {cleanTriageNote(email.triage_note)}
                                        </p>
                                    )}
                                    {email.triage_actions && email.triage_actions.length > 0 && (
                                        <ul className="flex flex-col gap-0.5 mt-1">
                                            {email.triage_actions.map((action, j) => (
                                                <li key={j} className="flex items-start gap-1.5 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                                                    <span className="shrink-0 mt-1 w-1 h-1 rounded-full" style={{ background: 'var(--theme-primary)' }} />
                                                    {action}
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                </button>
                                <button
                                    onClick={() => handleUnflag(email.id)}
                                    title="Remove flag"
                                    className="btn-ghost flagged shrink-0 self-center"
                                >
                                    <Star size={13} fill="#f59e0b" />
                                </button>
                            </div>
                        );
                    })}
                </div>
            )}
        </section>
    );
}
