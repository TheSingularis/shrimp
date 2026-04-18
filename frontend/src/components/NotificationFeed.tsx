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
}

function sourceIcon(source: string) {
    switch (source) {
        case "email_triage": return <Mail size={14} />;
        case "scheduler":
        case "job_complete": return <BriefcaseBusiness size={14} />;
        case "chat": return <MessageSquare size={14} />;
        default: return <Info size={14} />;
    }
}

function priorityColor(priority: string) {
    switch (priority) {
        case "high": return "var(--color-error, #ef4444)";
        case "low": return "var(--color-text-muted)";
        default: return "var(--accent)";
    }
}


function NotifCard({ n, onDismiss, onDelete, onNavigate }: {
    n: Notification;
    onDismiss: (id: string) => void;
    onDelete: (id: string) => void;
    onNavigate?: (panel: string) => void;
}) {
    return (
        <div
            className={`relative flex flex-col gap-1 px-3 py-2.5 rounded-lg border transition-colors ${
                n.read
                    ? "border-shrimp-border bg-shrimp-bg/40 opacity-60"
                    : "border-shrimp-border bg-shrimp-surface"
            }`}
        >
            <div className="flex items-start gap-2">
                <span style={{ color: priorityColor(n.priority), marginTop: 2 }}>
                    {sourceIcon(n.source)}
                </span>
                <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium leading-snug truncate">{n.title}</p>
                    <p className="text-xs text-shrimp-muted mt-0.5">{n.body}</p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                    {!n.read && (
                        <button
                            onClick={() => onDismiss(n.id)}
                            className="icon-btn"
                            title="Mark read"
                            style={{ color: 'var(--color-text-muted)' }}
                        >
                            <Check size={12} />
                        </button>
                    )}
                    <button
                        onClick={() => onDelete(n.id)}
                        className="icon-btn"
                        title="Delete"
                        style={{ color: 'var(--color-text-muted)' }}
                    >
                        <X size={12} />
                    </button>
                </div>
            </div>

            {n.actions.length > 0 && (
                <div className="flex gap-1.5 flex-wrap mt-1 ml-5">
                    {n.actions.map((a, i) => (
                        <button
                            key={i}
                            className="text-xs px-2 py-0.5 rounded border border-shrimp-border hover:bg-shrimp-surface transition-colors"
                            style={{ color: 'var(--accent)' }}
                            onClick={() => {
                                if (onNavigate && a.route.startsWith("/")) {
                                    const panel = a.route.split("/")[1] || "dashboard";
                                    onNavigate(panel);
                                }
                            }}
                        >
                            {a.label}
                        </button>
                    ))}
                </div>
            )}

            <span className="text-[10px] ml-5" style={{ color: 'var(--color-text-muted)' }}>
                {relativeTime(n.created_at)}
            </span>
        </div>
    );
}

export function NotificationFeed({ open, onClose, onNavigate, notifications, unreadCount, connected, onDismiss, onDelete }: Props) {
    if (!open) return null;

    const unread = notifications.filter(n => !n.read);
    const read = notifications.filter(n => n.read);

    return (
        <>
            {/* Backdrop */}
            <div
                className="fixed inset-0 z-40"
                onClick={onClose}
            />

            {/* Drawer */}
            <div className="fixed right-0 top-0 bottom-0 z-50 w-80 max-w-[90vw] flex flex-col bg-shrimp-surface border-l border-shrimp-border shadow-xl">
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-shrimp-border shrink-0">
                    <div className="flex items-center gap-2">
                        <Bell size={16} style={{ color: 'var(--accent)' }} />
                        <span className="font-semibold text-sm">Notifications</span>
                        {unreadCount > 0 && (
                            <span
                                className="text-xs rounded-full px-1.5 py-0.5 font-bold"
                                style={{ background: 'var(--accent)', color: '#fff' }}
                            >
                                {unreadCount}
                            </span>
                        )}
                        {!connected && (
                            <AlertCircle size={12} style={{ color: 'var(--color-error, #ef4444)' }} title="Disconnected" />
                        )}
                    </div>
                    <button
                        onClick={onClose}
                        className="p-1.5 rounded hover:bg-shrimp-border/50 transition-colors"
                        style={{ color: 'var(--color-text-muted)' }}
                    >
                        <X size={16} />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
                    {notifications.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-32 gap-2">
                            <Bell size={24} style={{ color: 'var(--color-text-muted)' }} />
                            <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>No notifications yet</p>
                        </div>
                    ) : (
                        <>
                            {unread.map(n => (
                                <NotifCard key={n.id} n={n} onDismiss={onDismiss} onDelete={onDelete} onNavigate={onNavigate} />
                            ))}
                            {unread.length > 0 && read.length > 0 && (
                                <div className="flex items-center gap-2 py-1">
                                    <div className="flex-1 border-t border-shrimp-border" />
                                    <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>Read</span>
                                    <div className="flex-1 border-t border-shrimp-border" />
                                </div>
                            )}
                            {read.map(n => (
                                <NotifCard key={n.id} n={n} onDismiss={onDismiss} onDelete={onDelete} onNavigate={onNavigate} />
                            ))}
                        </>
                    )}
                </div>
            </div>
        </>
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
