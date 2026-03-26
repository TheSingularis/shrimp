import { useState, useEffect, useRef } from "react";
import { type Scope, getModels, setModel, setScopes, deleteScope, getCtx, setCtx } from "../api";
import { getIndexStatus, triggerIndexAll, triggerIndexOne, type IndexStatus } from "../api"
import { pullModel, deleteModel } from "../api";
import { getCustomInstructions, setCustomInstructions } from "../api";

const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

interface Props {
    open: boolean;
    onClose: () => void;
    onScopesChanged: (scopes: Scope[]) => void;
}

// ── context slider ─────────────────────────────────────────────────────────────

const CTX_OPTIONS = [2048, 4096, 8192, 16384, 32768];

function ContextSlider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
    const idx = CTX_OPTIONS.indexOf(value);
    const selectedIdx = idx === -1 ? 2 : idx; // default to 8192

    return (
        <div className="ctx-slider-wrapper">
            <input
                type="range"
                className="ctx-slider"
                min={0}
                max={CTX_OPTIONS.length - 1}
                step={1}
                value={selectedIdx}
                onChange={(e) => onChange(CTX_OPTIONS[parseInt(e.target.value)])}
            />
            <div className="ctx-slider-labels">
                {CTX_OPTIONS.map((opt, i) => (
                    <span
                        key={opt}
                        className={`ctx-label ${i === selectedIdx ? "active" : ""}`}
                        onClick={() => onChange(opt)}
                    >
                        {opt >= 1024 ? `${opt / 1024}k` : opt}
                    </span>
                ))}
            </div>
            <div className="ctx-slider-value">{value.toLocaleString()} tokens</div>
        </div>
    );
}

// ── component ──────────────────────────────────────────────────────────────────

export function SettingsDrawer({ open, onClose, onScopesChanged }: Props) {
    const [models, setModels] = useState<string[]>([]);
    const [activeModel, setActiveModel] = useState("");
    const [scopes, setLocalScopes] = useState<Scope[]>([]);
    const [newName, setNewName] = useState("");
    const [newPath, setNewPath] = useState("");
    const [saving, setSaving] = useState(false);
    const saveTimerRef = useRef<number | null>(null);
    const [indexStatus, setIndexStatus] = useState<IndexStatus[]>([]);
    const [indexing, setIndexing] = useState<string | null>(null);
    const [indexProgress, setIndexProgress] = useState<Record<string, { current: number; total: number; file: string }>>({});
    const [pullInput, setPullInput] = useState("");
    const [pulling, setPulling] = useState(false);
    const [pullStatus, setPullStatus] = useState<string | null>(null);
    const [pullPercent, setPullPercent] = useState<number | null>(null);
    const [ctxValue, setCtxValue] = useState(8192);
    const [ctxSaving, setCtxSaving] = useState(false);
    const [customInstructions, setCustomInstructions] = useState("");
    const [customInstructionsSaving, setCustomInstructionsSaving] = useState(false);
    const customInstructionsTimerRef = useRef<number | null>(null);

    useEffect(() => {
        if (!open) return;
        getModels().then((data) => {
            setModels(data.models);
            setActiveModel(data.active);
        });
        getIndexStatus().then(setIndexStatus);
        fetch("http://localhost:8000/settings/scopes")
            .then((r) => r.json())
            .then(setLocalScopes);
        getCtx().then(setCtxValue).catch(() => {});
        getCustomInstructions().then(setCustomInstructions).catch(() => {});
    }, [open]);

    async function handleCtxChange(value: number) {
        setCtxValue(value);
        setCtxSaving(true);
        try {
            await setCtx(value);
        } finally {
            setCtxSaving(false);
        }
    }

    function handleCustomInstructionsChange(value: string) {
        setCustomInstructions(value);

        // Debounce save
        if (customInstructionsTimerRef.current !== null) {
            clearTimeout(customInstructionsTimerRef.current);
        }
        setCustomInstructionsSaving(true);
        customInstructionsTimerRef.current = window.setTimeout(async () => {
            await setCustomInstructions(value);
            setCustomInstructionsSaving(false);
            customInstructionsTimerRef.current = null;
        }, 1000);
    }

    async function handleModelChange(model: string) {
        setActiveModel(model);
        await setModel(model);
    }

    async function handleToggleScope(name: string) {
        // Update local state immediately for responsive UI
        const updated = scopes.map((s) =>
            s.name === name ? { ...s, enabled: !s.enabled } : s
        );
        setLocalScopes(updated);

        // Debounce the save to backend - wait 1s after last toggle
        if (saveTimerRef.current !== null) {
            clearTimeout(saveTimerRef.current);
        }
        setSaving(true);
        saveTimerRef.current = window.setTimeout(async () => {
            const result = await setScopes(updated);
            setLocalScopes(result);
            onScopesChanged(result);
            setSaving(false);
            saveTimerRef.current = null;
        }, 1000);
    }

    async function handleDeleteScope(name: string) {
        setSaving(true);
        const result = await deleteScope(name);
        setLocalScopes(result);
        onScopesChanged(result);
        setSaving(false);
    }

    async function handleAddScope() {
        if (!newName.trim() || !newPath.trim()) return;
        const updated = [...scopes, { name: newName.trim(), path: newPath.trim(), enabled: true }];
        setSaving(true);
        const result = await setScopes(updated);
        setLocalScopes(result);
        onScopesChanged(result);
        setNewName("");
        setNewPath("");
        setSaving(false);
    }

    function statusFor(name: string) {
        return indexStatus.find((s) => s.name === name);
    }

    function handleIndexOne(name: string): Promise<void> {
        return new Promise((resolve, reject) => {
            setIndexing(name);
            setIndexProgress({ ...indexProgress, [name]: { current: 0, total: 0, file: "" } });

            // Use SSE stream for real-time progress
            const url = `${BASE}/index/${name}/stream`;
            console.log(`[Index] Opening SSE stream: ${url}`);
            const eventSource = new EventSource(url);

            eventSource.onopen = () => {
                console.log(`[Index] SSE connection opened for ${name}`);
            };

            eventSource.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    console.log(`[Index] Progress update for ${name}:`, data);

                    if (data.done) {
                        console.log(`[Index] Indexing complete for ${name}`);
                        eventSource.close();
                        setIndexing(null);
                        setIndexProgress((prev) => {
                            const next = { ...prev };
                            delete next[name];
                            return next;
                        });
                        // Refresh status to show final file count
                        getIndexStatus().then(setIndexStatus);
                        resolve();
                    } else if (data.current && data.total) {
                        setIndexProgress((prev) => ({
                            ...prev,
                            [name]: { current: data.current, total: data.total, file: data.file || "" }
                        }));
                    } else if (data.ping) {
                        // Ignore ping messages
                    }
                } catch (e) {
                    console.error("[Index] Failed to parse progress:", e, event.data);
                }
            };

            eventSource.onerror = (err) => {
                console.error(`[Index] SSE error for ${name}:`, err);
                eventSource.close();
                setIndexing(null);
                setIndexProgress((prev) => {
                    const next = { ...prev };
                    delete next[name];
                    return next;
                });
                reject(err);
            };
        });
    }

    async function handleIndexAll() {
        setIndexing("all");
        const enabledScopes = scopes.filter((s) => s.enabled);

        if (enabledScopes.length === 0) {
            setIndexing(null);
            return;
        }

        console.log(`[Index All] Starting indexing for ${enabledScopes.length} scopes`);

        // Index each scope sequentially
        for (const scope of enabledScopes) {
            await handleIndexOne(scope.name);
        }

        console.log(`[Index All] All scopes complete`);
        setIndexing(null);
        getIndexStatus().then(setIndexStatus);
    }

    async function handlePullModel() {
        if (!pullInput.trim()) return;
        setPulling(true);
        setPullStatus("starting...");
        setPullPercent(null);
        try {
            await pullModel(pullInput.trim(), (status, percent) => {
                setPullStatus(status);
                setPullPercent(percent);
            });
            const data = await getModels();
            setModels(data.models);
            setActiveModel(data.active);
            setPullInput("");
            setPullStatus("done");
        } catch {
            setPullStatus("error pulling model");
        } finally {
            setPulling(false);
            setPullPercent(null);
        }
    }

    async function handleDeleteModel(model: string) {
        await deleteModel(model);
        const data = await getModels();
        setModels(data.models);
        setActiveModel(data.active);
    }

    return (
        <>
            {open && <div className="drawer-backdrop" onClick={onClose} />}
            <div className={`settings-drawer ${open ? "open" : ""}`}>
                <div className="drawer-header">
                    <span>Settings</span>
                    <button className="close-btn" onClick={onClose}>✕</button>
                </div>

                <section className="drawer-section">
                    <h2>Model</h2>
                    <div className="model-list">
                        {models.length === 0 && (
                            <span className="scope-status unindexed">no models installed</span>
                        )}
                        {models.map((m) => (
                            <div key={m} className="model-row">
                                <button
                                    className={`model-pill ${m === activeModel ? "active" : ""}`}
                                    onClick={() => handleModelChange(m)}
                                >
                                    {m}
                                </button>
                                <button
                                    className="delete-btn"
                                    onClick={() => handleDeleteModel(m)}
                                    title="Remove model"
                                >
                                    ✕
                                </button>
                            </div>
                        ))}
                    </div>

                    <div className="add-scope" style={{ marginTop: "0.75rem" }}>
                        <input
                            placeholder="e.g. qwen2.5-coder:7b"
                            value={pullInput}
                            onChange={(e) => setPullInput(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && handlePullModel()}
                            disabled={pulling}
                        />
                        <button onClick={handlePullModel} disabled={pulling || !pullInput.trim()}>
                            {pulling ? "pulling..." : "Pull"}
                        </button>
                    </div>

                    {pullStatus && (
                        <div className="scope-status" style={{ marginTop: "0.4rem" }}>
                            {pullStatus}
                            {pullPercent !== null && ` - ${pullPercent}%`}
                            {pulling && pullPercent !== null && (
                                <div className="pull-progress">
                                    <div
                                        className="pull-progress-bar"
                                        style={{ width: `${pullPercent}%` }}
                                    />
                                </div>
                            )}
                        </div>
                    )}
                </section>

                <section className="drawer-section">
                    <h2>
                        Context Window
                        {ctxSaving && <span className="saving">saving…</span>}
                    </h2>
                    <ContextSlider value={ctxValue} onChange={handleCtxChange} />
                </section>

                <section className="drawer-section">
                    <h2>
                        Custom Instructions
                        {customInstructionsSaving && <span className="saving">saving…</span>}
                    </h2>
                    <textarea
                        value={customInstructions}
                        onChange={(e) => handleCustomInstructionsChange(e.target.value)}
                        placeholder="Add custom instructions to append to all prompts...&#10;&#10;Example: 'Always use TypeScript for code examples' or 'Prefer functional programming patterns'"
                        rows={4}
                        style={{
                            width: "100%",
                            padding: "0.5rem",
                            borderRadius: "4px",
                            border: "1px solid var(--border)",
                            background: "var(--bg)",
                            color: "var(--text)",
                            fontFamily: "inherit",
                            fontSize: "0.85rem",
                            resize: "vertical"
                        }}
                    />
                </section>

                <section className="drawer-section">
                    <h2>Scopes {saving && <span className="saving">saving…</span>}</h2>
                    <div style={{ display: "flex", justifyContent: "flex-end" }}>
                        <button onClick={handleIndexAll} disabled={indexing !== null}>
                            {indexing === "all" ? "indexing…" : "↻ index all"}
                        </button>
                    </div>
                    <div className="scope-list">
                        {scopes.map((s) => {
                            const progress = indexProgress[s.name];
                            const percent = progress && progress.total > 0
                                ? Math.round((progress.current / progress.total) * 100)
                                : 0;

                            return (
                                <div key={s.name} className="scope-row">
                                    <div className="scope-info">
                                        <span className="scope-name">{s.name}</span>
                                        <span className="scope-path">{s.path}</span>
                                        {progress ? (
                                            <div style={{ width: '100%' }}>
                                                <span className="scope-status">
                                                    Indexing {progress.current}/{progress.total} files ({percent}%)
                                                    {progress.file && ` — ${progress.file}`}
                                                </span>
                                                <div className="pull-progress" style={{ width: '100%' }}>
                                                    <div
                                                        className="pull-progress-bar"
                                                        style={{ width: `${percent}%` }}
                                                    />
                                                </div>
                                            </div>
                                        ) : statusFor(s.name)?.last_indexed ? (
                                            <span className="scope-status">
                                                {statusFor(s.name)!.file_count} files · indexed{" "}
                                                {new Date(statusFor(s.name)!.last_indexed!).toLocaleTimeString()}
                                            </span>
                                        ) : (
                                            <span className="scope-status unindexed">not indexed</span>
                                        )}
                                    </div>
                                    <div className="scope-actions">
                                        <button
                                            className="index-btn"
                                            onClick={() => handleIndexOne(s.name)}
                                            disabled={indexing !== null}
                                        >
                                            {indexing === s.name ? "…" : "↻"}
                                        </button>
                                        <button
                                            className={`toggle-btn ${s.enabled ? "on" : "off"}`}
                                            onClick={() => handleToggleScope(s.name)}
                                        >
                                            {s.enabled ? "on" : "off"}
                                        </button>
                                        <button className="delete-btn" onClick={() => handleDeleteScope(s.name)}>✕</button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    <div className="add-scope">
                        <input
                            placeholder="name"
                            value={newName}
                            onChange={(e) => setNewName(e.target.value)}
                        />
                        <input
                            placeholder="/path/to/directory"
                            value={newPath}
                            onChange={(e) => setNewPath(e.target.value)}
                        />
                        <button onClick={handleAddScope} disabled={!newName || !newPath}>
                            Add
                        </button>
                    </div>
                </section>
            </div>
        </>
    );
}
