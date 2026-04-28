import { useEffect, useState } from "react";
import { MessageSquare, RefreshCw, CheckCircle, XCircle, Clock } from "lucide-react";
import { listAutomations, triggerAutomation, type Automation } from "../api";
import { listConversations, type ConversationMetadata } from "../api";
import { formatDate } from "../utils/email";
import { DailyChecklist } from "./DailyChecklist";
import type { ShrimpPluginFrontend } from "../plugins/types";

interface Props {
    plugins?: ShrimpPluginFrontend[];
    onNavigate: (panel: string, emailId?: string, conversationId?: string) => void;
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

    const borderColor = !automation.enabled
        ? "rgba(255,255,255,0.12)"
        : automation.last_result === "error"
            ? "var(--color-error, #ef4444)"
            : automation.last_result === "ok"
                ? "#10b981"
                : "rgba(255,255,255,0.12)";

    return (
        <div
            style={{
                border: "1px solid var(--border)",
                borderLeft: `3px solid ${borderColor}`,
                borderRadius: "0 8px 8px 0",
                padding: "10px 14px",
                background: "var(--surface)",
                marginBottom: 6,
                display: "flex",
                alignItems: "center",
                gap: 12,
                opacity: automation.enabled ? 1 : 0.65,
            }}
        >
            {/* 3-line content */}
            <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {automation.name}
                </p>
                {automation.description && (
                    <p className="text-xs truncate" style={{ color: 'var(--color-text-muted)', marginTop: 1 }}>
                        {automation.description}
                    </p>
                )}
                <div className="flex items-center gap-1.5" style={{ marginTop: 3, fontSize: 11, color: 'var(--color-text-muted)' }}>
                    {automation.last_result === "ok"
                        ? <CheckCircle size={11} style={{ color: '#10b981' }} />
                        : automation.last_result === "error"
                            ? <XCircle size={11} style={{ color: 'var(--color-error, #ef4444)' }} />
                            : <Clock size={11} />
                    }
                    <span>{automation.last_run ? formatDate(automation.last_run) : "Never"}</span>
                    {automation.cron && <span style={{ color: "var(--text-dim, #404669)" }}>· {automation.cron}</span>}
                </div>
            </div>
            {/* Run button */}
            <button
                onClick={handleTrigger}
                disabled={triggering || !automation.enabled}
                className="icon-btn shrink-0"
                title="Run now"
            >
                <RefreshCw size={13} className={triggering ? "animate-spin" : ""} />
            </button>
        </div>
    );
}

export function DashboardHome({ plugins = [], onNavigate }: Props) {
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

                    {/* Plugin dashboard cards */}
                    {plugins.flatMap(plugin =>
                        (plugin.DashboardCards ?? []).map((Card, i) => (
                            <div key={`${plugin.id}-card-${i}`} className="dashboard-card">
                                <Card onNavigate={onNavigate} />
                            </div>
                        ))
                    )}

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
                                            border: "1px solid var(--border)",
                                            borderLeft: "3px solid var(--theme-primary)",
                                            borderRadius: "0 8px 8px 0",
                                            padding: "10px 14px",
                                            background: "var(--surface)",
                                            marginBottom: 6,
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
                                {automations.filter(a => a.enabled).map(automation => (
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
