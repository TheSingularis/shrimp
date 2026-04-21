import { useEffect, useRef, useState } from "react";
import { RefreshCw, CheckCircle, XCircle, Clock } from "lucide-react";
import { listAutomations, triggerAutomation, updateAutomation, type Automation } from "../api";
import { formatDate as formatDateShort } from "../utils/email";

function formatLastRun(iso: string | null) {
    if (!iso) return "Never";
    return formatDateShort(iso);
}

function accentColor(automation: Automation): string {
    if (!automation.enabled) return "rgba(255,255,255,0.12)";
    if (automation.last_result === "error") return "var(--color-error, #ef4444)";
    if (automation.last_result === "ok") return "#10b981";
    return "rgba(255,255,255,0.12)";
}

function AutomationRow({ automation, onRefresh }: { automation: Automation; onRefresh: () => void }) {
    const [toggling, setToggling] = useState(false);
    const wasRunningRef = useRef(false);

    useEffect(() => {
        if (wasRunningRef.current && !automation.running) {
            window.dispatchEvent(new CustomEvent("checklist-refresh"));
        }
        wasRunningRef.current = automation.running;
    }, [automation.running]);

    async function handleRun() {
        try {
            await triggerAutomation(automation.name);
            onRefresh();
        } catch (e) {
            console.error(e);
        }
    }

    async function handleToggle() {
        setToggling(true);
        try {
            await updateAutomation(automation.name, { enabled: !automation.enabled });
            onRefresh();
        } catch (e) {
            console.error(e);
        } finally {
            setToggling(false);
        }
    }

    const accent = accentColor(automation);

    return (
        <div
            style={{
                border: "1px solid var(--border)",
                borderLeft: `3px solid ${accent}`,
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
            {/* Left: 3-line info */}
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
                    <span style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 13,
                        fontWeight: 500,
                        color: "var(--text)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                    }}>
                        {automation.name}
                    </span>
                    {!automation.enabled && (
                        <span style={{
                            fontSize: 10, fontWeight: 600, letterSpacing: "0.08em",
                            textTransform: "uppercase", color: "var(--text-muted)",
                            border: "1px solid var(--border)", borderRadius: 3,
                            padding: "1px 5px",
                        }}>disabled</span>
                    )}
                    {automation.running && (
                        <span style={{
                            fontSize: 10, fontWeight: 600, letterSpacing: "0.08em",
                            textTransform: "uppercase", color: "var(--accent)",
                            background: "var(--accent-dim)", borderRadius: 3,
                            padding: "1px 5px",
                        }}>running</span>
                    )}
                </div>

                {automation.description && (
                    <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {automation.description}
                    </p>
                )}

                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-muted)" }}>
                    {automation.running
                        ? <Clock size={11} className="animate-spin" style={{ color: "var(--accent)" }} />
                        : automation.last_result === "ok"
                            ? <CheckCircle size={11} style={{ color: "#10b981" }} />
                            : automation.last_result === "error"
                                ? <XCircle size={11} style={{ color: "var(--color-error, #ef4444)" }} />
                                : <Clock size={11} />
                    }
                    <span>{formatLastRun(automation.last_run)}</span>
                    {automation.cron && <span style={{ color: "var(--text-dim)" }}>· {automation.cron}</span>}
                </div>
            </div>

            {/* Right: action buttons */}
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                <button
                    onClick={handleRun}
                    disabled={automation.running || !automation.enabled}
                    className="btn-secondary"
                    title="Run now"
                >
                    <RefreshCw size={12} className={automation.running ? "animate-spin" : ""} />
                    {automation.running ? "Running…" : "Run"}
                </button>
                <button
                    onClick={handleToggle}
                    disabled={toggling}
                    className="btn-secondary"
                >
                    {automation.enabled ? "Disable" : "Enable"}
                </button>
            </div>
        </div>
    );
}

export function AutomationsPanel() {
    const [automations, setAutomations] = useState<Automation[]>([]);
    const [loading, setLoading] = useState(true);
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

    async function refresh() {
        try {
            const data = await listAutomations();
            setAutomations(data);
            return data;
        } catch (e) {
            console.error(e);
            return null;
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        const anyRunning = automations.some(a => a.running);
        if (anyRunning && !pollRef.current) {
            pollRef.current = setInterval(refresh, 1500);
        } else if (!anyRunning && pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
        }
    }, [automations]);

    useEffect(() => {
        refresh();
        return () => {
            if (pollRef.current) clearInterval(pollRef.current);
        };
    }, []);

    return (
        <div style={{ flex: 1, overflowY: "auto", padding: "24px" }}>
            <div style={{ maxWidth: 680, margin: "0 auto" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
                    <div>
                        <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 2 }}>Tasks</h2>
                        <p style={{ fontSize: 12, color: "var(--text-muted)" }}>Scheduled automation tasks</p>
                    </div>
                    <button onClick={refresh} className="btn-ghost" title="Refresh">
                        <RefreshCw size={15} />
                    </button>
                </div>

                {loading ? (
                    <p style={{ fontSize: 13, color: "var(--text-muted)" }}>Loading…</p>
                ) : automations.length === 0 ? (
                    <div style={{
                        border: "1px solid var(--border)",
                        borderLeft: "3px solid rgba(255,255,255,0.12)",
                        borderRadius: "0 8px 8px 0",
                        padding: "32px 24px",
                        background: "var(--surface)",
                        textAlign: "center",
                    }}>
                        <Clock size={28} style={{ color: "var(--text-muted)", margin: "0 auto 10px" }} />
                        <p style={{ fontSize: 13, fontWeight: 500 }}>No tasks configured</p>
                        <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
                            Tasks will appear here as they are added.
                        </p>
                    </div>
                ) : (
                    <div>
                        {automations.map(a => (
                            <AutomationRow key={a.name} automation={a} onRefresh={refresh} />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
