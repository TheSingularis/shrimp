import { useEffect, useState } from "react";
import { RefreshCw, CheckCircle, XCircle, Clock, Play, ToggleLeft, ToggleRight } from "lucide-react";
import { listJobs, triggerJob, updateJob, type Job } from "../api";
import { formatDate as formatDateShort } from "../utils/email";

function formatDate(iso: string | null) {
    if (!iso) return "Never";
    return formatDateShort(iso);
}

function StatusIcon({ result }: { result: Job["last_result"] }) {
    if (result === "ok") return <CheckCircle size={16} style={{ color: 'var(--color-success, #22c55e)' }} />;
    if (result === "error") return <XCircle size={16} style={{ color: 'var(--color-error, #ef4444)' }} />;
    return <Clock size={16} style={{ color: 'var(--color-text-muted)' }} />;
}

function JobCard({ job, onRefresh }: { job: Job; onRefresh: () => void }) {
    const [running, setRunning] = useState(false);
    const [toggling, setToggling] = useState(false);

    async function handleRun() {
        setRunning(true);
        try {
            await triggerJob(job.name);
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
            await updateJob(job.name, { enabled: !job.enabled });
            onRefresh();
        } catch (e) {
            console.error(e);
        } finally {
            setToggling(false);
        }
    }

    return (
        <div className="rounded-xl border border-shrimp-border bg-shrimp-surface p-4 flex flex-col gap-3">
            <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                        <StatusIcon result={job.last_result} />
                        <h3 className="font-semibold text-sm truncate">{job.name}</h3>
                        {!job.enabled && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded border border-shrimp-border" style={{ color: 'var(--color-text-muted)' }}>
                                disabled
                            </span>
                        )}
                    </div>
                    {job.description && (
                        <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>{job.description}</p>
                    )}
                </div>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                    <span style={{ color: 'var(--color-text-muted)' }}>Schedule</span>
                    <p className="font-mono mt-0.5">{job.cron || "—"}</p>
                </div>
                <div>
                    <span style={{ color: 'var(--color-text-muted)' }}>Last run</span>
                    <p className="mt-0.5">{formatDate(job.last_run)}</p>
                </div>
            </div>

            <div className="flex gap-2">
                <button onClick={handleRun} disabled={running} className="btn-secondary">
                    <Play size={12} className={running ? "opacity-50" : ""} />
                    {running ? "Running…" : "Run now"}
                </button>
                <button onClick={handleToggle} disabled={toggling} className="btn-secondary">
                    {job.enabled
                        ? <><ToggleRight size={14} style={{ color: 'var(--accent)' }} /> Disable</>
                        : <><ToggleLeft size={14} /> Enable</>
                    }
                </button>
            </div>
        </div>
    );
}

export function JobsPanel() {
    const [jobs, setJobs] = useState<Job[]>([]);
    const [loading, setLoading] = useState(true);

    async function refresh() {
        try {
            const data = await listJobs();
            setJobs(data);
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
                    <h2 className="text-xl font-bold">Background Jobs</h2>
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
            ) : jobs.length === 0 ? (
                <div className="rounded-xl border border-shrimp-border bg-shrimp-surface p-8 text-center">
                    <Clock size={32} className="mx-auto mb-3" style={{ color: 'var(--color-text-muted)' }} />
                    <p className="text-sm font-medium">No jobs configured</p>
                    <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
                        Background jobs will appear here as they are added in future phases.
                    </p>
                </div>
            ) : (
                <div className="grid gap-3">
                    {jobs.map(job => (
                        <JobCard key={job.name} job={job} onRefresh={refresh} />
                    ))}
                </div>
            )}
        </div>
    );
}
