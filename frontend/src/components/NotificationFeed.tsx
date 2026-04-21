import { Bell, X, Check, AlertCircle, Info, Mail, BriefcaseBusiness, MessageSquare } from "lucide-react";
import type { Notification } from "../hooks/useNotifications";
import { relativeTime } from "../utils/email";

interface Props {
    open: boolean;
    onClose: () => void;
    onNavigate?: (panel: string) => void;
    notifications: Notification[];
    unreadCount: number;
    connected: boolean;
    onDismiss: (id: string) => void;
    onDelete: (id: string) => void;
    topOffset?: number;
}

function sourceIcon(source: string) {
    switch (source) {
        case "email_triage": return <Mail size={14} />;
        case "scheduler":
        case "automation_complete": return <BriefcaseBusiness size={14} />;
        case "chat": return <MessageSquare size={14} />;
        default: return <Info size={14} />;
    }
}

function accentColor(priority: string) {
    switch (priority) {
        case "high": return "var(--color-error, #ef4444)";
        case "low": return "var(--color-text-muted)";
        default: return "var(--theme-primary)";
    }
}

function NotifRow({ n, onDismiss, onDelete, onNavigate }: {
    n: Notification;
    onDismiss: (id: string) => void;
    onDelete: (id: string) => void;
    onNavigate?: (panel: string) => void;
}) {
    const accent = accentColor(n.priority);

    function handleClick() {
        if (onNavigate && n.actions.length > 0) {
            const route = n.actions[0].route;
            if (route.startsWith("/")) {
                onNavigate(route.split("/")[1] || "dashboard");
            }
        }
        onDismiss(n.id);
    }

    return (
        <div
            onClick={handleClick}
            style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
                border: "1px solid var(--border)",
                borderLeft: `3px solid ${accent}`,
                borderRadius: "0 8px 8px 0",
                padding: "10px 14px",
                background: n.read ? "transparent" : "var(--surface)",
                marginBottom: 6,
                width: "100%",
                opacity: n.read ? 0.5 : 1,
                cursor: n.actions.length > 0 ? "pointer" : "default",
                transition: "background 0.12s",
            }}
        >
            <span style={{ color: accent, marginTop: 2, flexShrink: 0 }}>
                {sourceIcon(n.source)}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 13, fontWeight: 500, color: "var(--color-text)", marginBottom: 2 }}>{n.title}</p>
                <p style={{ fontSize: 12, color: "var(--color-text-muted)" }}>{n.body}</p>
                <span style={{ fontSize: 11, color: "var(--color-text-muted)", display: "block", marginTop: 4 }}>
                    {relativeTime(n.created_at)}
                </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
                {!n.read && (
                    <button
                        onClick={(e) => { e.stopPropagation(); onDismiss(n.id); }}
                        className="btn-ghost"
                        title="Mark read"
                    >
                        <Check size={12} />
                    </button>
                )}
                <button
                    onClick={(e) => { e.stopPropagation(); onDelete(n.id); }}
                    className="btn-ghost"
                    title="Delete"
                >
                    <X size={12} />
                </button>
            </div>
        </div>
    );
}

export function NotificationFeed({ open, onClose, onNavigate, notifications, unreadCount, connected, onDismiss, onDelete }: Props) {
    if (!open) return null;

    const urgent = notifications.filter(n => n.priority === "high");
    const today = notifications.filter(n => n.priority !== "high");

    function markAllRead() {
        notifications.filter(n => !n.read).forEach(n => onDismiss(n.id));
    }

    const unread = notifications.filter(n => !n.read);

    return (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            {/* Header */}
            <div style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "16px 24px",
                borderBottom: "1px solid var(--border)",
                flexShrink: 0,
            }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <Bell size={16} style={{ color: "var(--theme-primary)" }} />
                    <span style={{ fontWeight: 600, fontSize: 14 }}>Notifications</span>
                    {unreadCount > 0 && (
                        <span style={{
                            fontSize: 11, fontWeight: 700,
                            background: "var(--theme-primary)", color: "#fff",
                            borderRadius: 999, padding: "1px 7px",
                        }}>
                            {unreadCount}
                        </span>
                    )}
                    {!connected && (
                        <span title="Disconnected"><AlertCircle size={12} style={{ color: "var(--color-error, #ef4444)" }} /></span>
                    )}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                    {unread.length > 0 && (
                        <button className="btn-secondary" onClick={markAllRead}>
                            Mark all read
                        </button>
                    )}
                    <button className="btn-ghost" onClick={onClose} title="Close">
                        <X size={16} />
                    </button>
                </div>
            </div>

            {/* Content */}
            <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
                {notifications.length === 0 ? (
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 200, gap: 12 }}>
                        <Bell size={32} style={{ color: "var(--color-text-muted)" }} />
                        <p style={{ color: "var(--color-text-muted)", fontSize: 14 }}>All clear</p>
                    </div>
                ) : (
                    <div style={{ maxWidth: 680, margin: "0 auto" }}>
                        {urgent.length > 0 && (
                            <div style={{ marginBottom: 24 }}>
                                <p style={{
                                    fontSize: 10, fontWeight: 600, letterSpacing: "0.12em",
                                    textTransform: "uppercase", color: "var(--color-text-muted)",
                                    fontFamily: "var(--font-mono, monospace)", marginBottom: 10,
                                }}>
                                    Urgent
                                </p>
                                {urgent.map(n => (
                                    <NotifRow key={n.id} n={n} onDismiss={onDismiss} onDelete={onDelete} onNavigate={onNavigate} />
                                ))}
                            </div>
                        )}
                        {today.length > 0 && (
                            <div>
                                <p style={{
                                    fontSize: 10, fontWeight: 600, letterSpacing: "0.12em",
                                    textTransform: "uppercase", color: "var(--color-text-muted)",
                                    fontFamily: "var(--font-mono, monospace)", marginBottom: 10,
                                }}>
                                    Today
                                </p>
                                {today.map(n => (
                                    <NotifRow key={n.id} n={n} onDismiss={onDismiss} onDelete={onDelete} onNavigate={onNavigate} />
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

export function NotificationBadge({ count, onClick }: { count: number; onClick: () => void }) {
    return (
        <button
            onClick={onClick}
            className="nav-btn relative flex flex-col items-center justify-center gap-1"
            title="Notifications"
            style={{ width: '44px', height: '44px', color: 'var(--color-text-muted)' }}
        >
            <Bell size={18} style={{ color: 'var(--accent)' }} />
            <span style={{ fontSize: '9px', fontWeight: 500, lineHeight: 1 }} className="hidden sm:block">Alerts</span>
            {count > 0 && (
                <span
                    className="absolute top-1.5 right-1.5 min-w-[14px] h-[14px] rounded-full flex items-center justify-center text-[9px] font-bold leading-none px-[3px]"
                    style={{ background: 'var(--accent)', color: '#fff' }}
                >
                    {count > 99 ? "99+" : count}
                </span>
            )}
        </button>
    );
}
