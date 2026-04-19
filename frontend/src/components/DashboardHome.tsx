import { useEffect, useRef, useState } from "react";
import { MessageSquare, Mail, BriefcaseBusiness, RefreshCw, CheckCircle, XCircle, Clock, Star, Sparkles } from "lucide-react";
import { listAutomations, triggerAutomation, type Automation, getDigest, type DigestData, getInbox, getFlaggedEmails, setEmailFlag, type EmailMeta } from "../api";
import { listConversations, type ConversationMetadata } from "../api";
import { senderName, formatDate } from "../utils/email";
import { PRIORITY_ORDER, UrgencyBadge, toUrgencyLevel } from "../utils/urgency";
import { DailyChecklist } from "./DailyChecklist";

type Panel = "chat" | "dashboard" | "email" | "automations";

interface Props {
    onNavigate: (panel: Panel, emailId?: string, conversationId?: string) => void;
}

function QuickAction({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
    return (
        <button onClick={onClick} className="btn-card">
            <span className="card-icon">{icon}</span>
            <span>{label}</span>
        </button>
    );
}

function AutomationRow({ automation, onTrigger }: { automation: Automation; onTrigger: (name: string) => void }) {
    const [triggering, setTriggering] = useState(false);

    async function handleTrigger() {
        setTriggering(true);
        try {
            await onTrigger(automation.name);
        } finally {
            setTimeout(() => setTriggering(false), 1500);
        }
    }

    function formatLastRun(iso: string | null) {
        if (!iso) return "Never";
        return formatDate(iso);
    }

    const borderColor = automation.last_result === "error"
        ? "var(--color-error, #ef4444)"
        : automation.last_result === "ok"
        ? "rgba(255,255,255,0.07)"
        : "rgba(255,255,255,0.07)";

    return (
        <div
            className="flex items-center gap-3"
            style={{
                borderLeft: `2px solid ${borderColor}`,
                borderRadius: "0 6px 6px 0",
                padding: "10px 14px",
                background: "rgba(255,255,255,0.02)",
            }}
        >
            <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{automation.name}</p>
                <p className="text-xs truncate" style={{ color: 'var(--color-text-muted)' }}>
                    {automation.description || automation.cron || "Manual"}
                </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
                {automation.last_result === "ok" && <CheckCircle size={14} style={{ color: 'var(--color-success, #22c55e)' }} />}
                {automation.last_result === "error" && <XCircle size={14} style={{ color: 'var(--color-error, #ef4444)' }} />}
                {!automation.last_result && <Clock size={14} style={{ color: 'var(--color-text-muted)' }} />}
                <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                    {formatLastRun(automation.last_run)}
                </span>
                <button
                    onClick={handleTrigger}
                    disabled={triggering || !automation.enabled}
                    className="icon-btn"
                    title="Run now"
                    style={{ color: 'var(--accent)' }}
                >
                    <RefreshCw size={13} className={triggering ? "animate-spin" : ""} />
                </button>
            </div>
        </div>
    );
}

const URGENCY_DOT: Record<string, string> = {
    urgent: "#ef4444",
    high:   "#f97316",
};

function isToday(iso: string): boolean {
    return new Date(iso).toDateString() === new Date().toDateString();
}

function EmailSection({ onNavigate, onTriggerDigest }: {
    onNavigate: (panel: Panel, emailId?: string) => void;
    onTriggerDigest: () => Promise<void>;
}) {
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
            // Kick off triage immediately if there are untriaged emails
            const hasUntriaged = unread.some(e => !e.triaged);
            if (hasUntriaged && !triageQueued.current) {
                triageQueued.current = true;
                triggerAutomation("email_triage").catch(() => {});
                // Allow re-triggering after 5 min in case more emails arrive
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
            await onTriggerDigest();
            await new Promise(r => setTimeout(r, 12000));
            await loadDigest();
        } finally {
            setDigestRefreshing(false);
        }
    }

    const visible = emails.filter(e => showSpam || e.triage_priority !== "spam").slice(0, 25);
    const spamCount = emails.filter(e => e.triage_priority === "spam").length;
    const untriaged = emails.filter(e => !e.triage_priority).length;

    // Show digest if generated today — always, not just when inbox is clear
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
                <div className="flex items-center gap-2">
                    <button onClick={() => onNavigate("email")} className="btn-primary">
                        Open inbox
                    </button>
                </div>
            </div>

            {loading ? (
                <p className="text-sm py-2" style={{ color: 'var(--color-text-muted)' }}>Loading...</p>
            ) : visible.length === 0 ? (
                <div className="flex flex-col gap-1.5">
                    {!freshDigest && (
                        <div
                            style={{
                                borderLeft: "2px solid rgba(255,255,255,0.07)",
                                borderRadius: "0 6px 6px 0",
                                padding: "10px 14px",
                                background: "rgba(255,255,255,0.02)",
                            }}
                        >
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
                                borderLeft: "2px solid var(--accent)",
                                borderRadius: "0 6px 6px 0",
                                padding: "10px 14px",
                                background: "color-mix(in srgb, var(--accent) 6%, transparent)",
                                color: "var(--accent)",
                                fontSize: 13,
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
                                className="btn-row w-full flex items-start gap-3 hover:bg-white/[0.03] cursor-pointer"
                                style={{
                                    borderLeft: `2px solid ${leftBorderColor}`,
                                    borderRadius: "0 6px 6px 0",
                                    padding: "12px 14px",
                                    background: "rgba(255,255,255,0.02)",
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
                                    {email.triage_note ? (
                                        <p className="text-xs leading-relaxed" style={{ color: 'var(--color-text-muted)', opacity: 0.6 }}>
                                            {email.triage_note}
                                        </p>
                                    ) : !email.triaged ? (
                                        <p className="text-xs italic" style={{ color: 'var(--color-text-muted)', opacity: 0.4 }}>
                                            Pending triage...
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

function FlaggedSection({ onNavigate }: { onNavigate: (panel: Panel, emailId?: string) => void }) {
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
            load(); // reload on error
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
                                    borderLeft: `2px solid ${leftBorderColor}`,
                                    borderRadius: "0 6px 6px 0",
                                    background: "rgba(255,255,255,0.02)",
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
                                    {email.triage_note && (
                                        <p className="text-xs" style={{ color: 'var(--color-text-muted)', opacity: 0.6 }}>
                                            {email.triage_note}
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

export function DashboardHome({ onNavigate }: Props) {
    const [automations, setAutomations] = useState<Automation[]>([]);
    const [recentConvs, setRecentConvs] = useState<ConversationMetadata[]>([]);

    useEffect(() => {
        listAutomations().then(setAutomations).catch(() => {});
        listConversations()
            .then(convs => setRecentConvs(convs.slice(0, 3)))
            .catch(() => {});
    }, []);

    async function handleTrigger(name: string) {
        await triggerAutomation(name);
        setTimeout(() => listAutomations().then(setAutomations).catch(() => {}), 2000);
    }

    return (
        <div className="flex-1 overflow-y-auto p-4 md:p-6">
            <div className="max-w-7xl mx-auto">
                <h2 className="text-xl font-bold mb-1">Dashboard</h2>
                <p className="text-sm mb-6" style={{ color: 'var(--color-text-muted)' }}>
                    Your local intelligence hub
                </p>

                {/* Masonry columns — 1 col narrow, 2 col medium, 3 col wide */}
                <div className="dashboard-masonry">

                    {/* Quick actions */}
                    {/* <section className="dashboard-card mb-6">
                        <h3 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--color-text-muted)' }}>
                            Quick Actions
                        </h3>
                        <div className="grid grid-cols-3 gap-3">
                            <QuickAction icon={<MessageSquare size={20} />} label="New Chat" onClick={() => onNavigate("chat")} />
                            <QuickAction icon={<Mail size={20} />} label="Email" onClick={() => onNavigate("email")} />
                            <QuickAction icon={<BriefcaseBusiness size={20} />} label="Automations" onClick={() => onNavigate("automations")} />
                        </div>
                    </section> */}

                    {/* Daily Focus Checklist */}
                    <div className="dashboard-card">
                        <DailyChecklist onNavigate={onNavigate} />
                    </div>

                    {/* Flagged emails */}
                    <div className="dashboard-card">
                        <FlaggedSection onNavigate={onNavigate} />
                    </div>

                    {/* Inbox + digest summary */}
                    <div className="dashboard-card">
                        <EmailSection onNavigate={onNavigate} onTriggerDigest={() => handleTrigger("daily_digest")} />
                    </div>

                    {/* Recent conversations */}
                    {recentConvs.length > 0 && (
                        <section className="dashboard-card mb-6">
                            <h3 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--color-text-muted)' }}>
                                Recent Conversations
                            </h3>
                            <div className="flex flex-col gap-1.5">
                                {recentConvs.map((c) => (
                                    <button
                                        key={c.conversation_id}
                                        onClick={() => onNavigate("chat", undefined, c.conversation_id)}
                                        className="btn-row w-full flex items-center gap-3"
                                        style={{
                                            borderLeft: "2px solid rgba(255,255,255,0.07)",
                                            borderRadius: "0 6px 6px 0",
                                            padding: "10px 14px",
                                            background: "rgba(255,255,255,0.02)",
                                        }}
                                    >
                                        <MessageSquare size={14} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                                        <div className="flex-1 min-w-0 text-left">
                                            <p className="text-sm truncate">{c.title || "Untitled"}</p>
                                            <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                                                {c.message_count} messages · {formatDate(new Date(c.updated_at).toISOString())}
                                            </p>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </section>
                    )}

                    {/* Automations */}
                    {automations.length > 0 && (
                        <section className="dashboard-card mb-6">
                            <h3 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--color-text-muted)' }}>
                                Automations
                            </h3>
                            <div className="flex flex-col gap-1.5">
                                {automations.map(automation => (
                                    <AutomationRow key={automation.name} automation={automation} onTrigger={handleTrigger} />
                                ))}
                            </div>
                        </section>
                    )}

                </div>
            </div>
        </div>
    );
}
