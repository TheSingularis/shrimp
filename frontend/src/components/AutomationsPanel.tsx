import { useEffect, useState } from "react";
import { RefreshCw, CheckCircle, XCircle, Clock, Play, ToggleLeft, ToggleRight } from "lucide-react";
import { listAutomations, triggerAutomation, updateAutomation, type Automation } from "../api";
import { formatDate as formatDateShort } from "../utils/email";

function formatDate(iso: string | null) {
    if (!iso) return "Never";
    return formatDateShort(iso);
}

function StatusIcon({ result }: { result: Automation["last_result"] }) {
    if (result === "ok") return <CheckCircle size={16} style={{ color: 'var(--color-success, #22c55e)' }} />;
    if (result === "error") return <XCircle size={16} style={{ color: 'var(--color-error, #ef4444)' }} />;
    return <Clock size={16} style={{ color: 'var(--color-text-muted)' }} />;
}

function AutomationCard({ automation, onRefresh }: { automation: Automation; onRefresh: () => void }) {
    const [running, setRunning] = useState(false);
    const [toggling, setToggling] = useState(false);

    async function handleRun() {
        setRunning(true);
        try {
            await triggerAutomation(automation.name);
            setTimeout(onRefresh, 2000);
        } catch (e) {
            console.error(e);
        } finally {
            setTimeout(() => setRunning(false), 1500);
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
                        <StatusIcon result={automation.last_result} />
                        <h3 className="font-semibold text-sm truncate">{automation.name}</h3>
                        {!automation.enabled && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded border border-shrimp-border" style={{ color: 'var(--color-text-muted)' }}>
                                disabled
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
                <button onClick={handleRun} disabled={running} className="btn-secondary">
                    <Play size={12} className={running ? "opacity-50" : ""} />
                    {running ? "Running…" : "Run now"}
                </button>
                <button onClick={handleToggle} disabled={toggling} className="btn-secondary">
                    {automation.enabled
                        ? <><ToggleRight size={14} style={{ color: 'var(--accent)' }} /> Disable</>
                        : <><ToggleLeft size={14} /> Enable</>
                    }
                </button>
            </div>
            {(running || toggling) && <div className="indeterminate-bar" />}
        </div>
    );
}

export function AutomationsPanel() {
    const [automations, setAutomations] = useState<Automation[]>([]);
    const [loading, setLoading] = useState(true);

    async function refresh() {
        try {
            const data = await listAutomations();
            setAutomations(data);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => { refresh(); }, []);

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
