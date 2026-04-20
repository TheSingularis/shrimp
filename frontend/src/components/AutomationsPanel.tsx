import { useEffect, useRef, useState } from "react";
import { RefreshCw, CheckCircle, XCircle, Clock, Play, ToggleLeft, ToggleRight } from "lucide-react";
import { listAutomations, triggerAutomation, updateAutomation, type Automation } from "../api";
import { formatDate as formatDateShort } from "../utils/email";

function formatDate(iso: string | null) {
    if (!iso) return "Never";
    return formatDateShort(iso);
}

function StatusIcon({ result, running }: { result: Automation["last_result"]; running: boolean }) {
    if (running) return <Clock size={16} className="animate-spin" style={{ color: 'var(--accent)' }} />;
    if (result === "ok") return <CheckCircle size={16} style={{ color: 'var(--color-success, #22c55e)' }} />;
    if (result === "error") return <XCircle size={16} style={{ color: 'var(--color-error, #ef4444)' }} />;
    return <Clock size={16} style={{ color: 'var(--color-text-muted)' }} />;
}

function AutomationCard({ automation, onRefresh }: { automation: Automation; onRefresh: () => void }) {
    const [toggling, setToggling] = useState(false);
    const wasRunningRef = useRef(false);

    // When automation transitions from running → done, refresh checklist
    useEffect(() => {
        if (wasRunningRef.current && !automation.running) {
            window.dispatchEvent(new CustomEvent("checklist-refresh"));
        }
        wasRunningRef.current = automation.running;
    }, [automation.running]);

    async function handleRun() {
        try {
            await triggerAutomation(automation.name);
            // Kick off polling by refreshing parent immediately
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

    return (
        <div className="rounded-xl border border-shrimp-border bg-shrimp-surface p-4 flex flex-col gap-3" style={{ position: 'relative', overflow: 'hidden' }}>
            <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                        <StatusIcon result={automation.last_result} running={automation.running} />
                        <h3 className="font-semibold text-sm truncate">{automation.name}</h3>
                        {!automation.enabled && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded border border-shrimp-border" style={{ color: 'var(--color-text-muted)' }}>
                                disabled
                            </span>
                        )}
                        {automation.running && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ color: 'var(--accent)', background: 'rgba(var(--accent-rgb, 91,79,207),0.12)' }}>
                                running
                            </span>
                        )}
                    </div>
                    {automation.description && (
                        <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>{automation.description}</p>
                    )}
                </div>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                    <span style={{ color: 'var(--color-text-muted)' }}>Schedule</span>
                    <p className="font-mono mt-0.5">{automation.cron || "—"}</p>
                </div>
                <div>
                    <span style={{ color: 'var(--color-text-muted)' }}>Last run</span>
                    <p className="mt-0.5">{formatDate(automation.last_run)}</p>
                </div>
            </div>

            <div className="flex gap-2">
                <button onClick={handleRun} disabled={automation.running} className="btn-secondary">
                    <Play size={12} className={automation.running ? "opacity-50" : ""} />
                    {automation.running ? "Running…" : "Run now"}
                </button>
                <button onClick={handleToggle} disabled={toggling} className="btn-secondary">
                    {automation.enabled
                        ? <><ToggleRight size={14} style={{ color: 'var(--accent)' }} /> Disable</>
                        : <><ToggleLeft size={14} /> Enable</>
                    }
                </button>
            </div>
            {(automation.running || toggling) && <div className="indeterminate-bar" />}
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

    // Start/stop polling based on whether any automation is running
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
        <div className="flex-1 overflow-y-auto p-4 md:p-6 max-w-3xl mx-auto w-full">
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h2 className="text-xl font-bold">Automations</h2>
                    <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
                        Scheduled automation tasks
                    </p>
                </div>
                <button onClick={refresh} className="btn-ghost" title="Refresh">
                    <RefreshCw size={16} />
                </button>
            </div>

            {loading ? (
                <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>Loading…</p>
            ) : automations.length === 0 ? (
                <div className="rounded-xl border border-shrimp-border bg-shrimp-surface p-8 text-center">
                    <Clock size={32} className="mx-auto mb-3" style={{ color: 'var(--color-text-muted)' }} />
                    <p className="text-sm font-medium">No automations configured</p>
                    <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
                        Automations will appear here as they are added.
                    </p>
                </div>
            ) : (
                <div className="grid gap-3">
                    {automations.map(automation => (
                        <AutomationCard key={automation.name} automation={automation} onRefresh={refresh} />
                    ))}
                </div>
            )}
        </div>
    );
}
