import { useState, useEffect, useRef } from "react";
import { type Scope, getScopes, getModels, setModel, setScopes, deleteScope, getCtx, setCtx } from "../api";
import { getIndexStatus, triggerIndexAll, triggerIndexOne, type IndexStatus } from "../api"
import { pullModel, deleteModel } from "../api";
import { getCustomInstructions, setCustomInstructions, generateScopeDescription, getWebSearchEnabled, setWebSearchEnabled } from "../api";
import { getTheme, setTheme, getLanguage, setLanguage, getOllamaHostSetting, setOllamaHostSetting } from "../api";
import type { ShrimpPluginFrontend } from "../plugins/types";
import { usePluginManager } from "../plugins/context";
import { X, RefreshCw, Sparkles, Loader2, Puzzle } from "lucide-react";
import "./SettingsModal.css";

const BASE = import.meta.env.VITE_API_URL ?? `http://${window.location.hostname || 'localhost'}:8000`;

interface Props {
    open: boolean;
    onClose: () => void;
    onScopesChanged: (scopes: Scope[]) => void;
    plugins?: ShrimpPluginFrontend[];
}

type CoreTabType = "appearance" | "models" | "scopes" | "advanced" | "plugins" | "about";
type TabType = CoreTabType | string; // plugin ids become additional tabs

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

// ── model size detection ───────────────────────────────────────────────────────

function getModelSize(modelName: string): number | null {
    // Extract parameter count from model name (e.g., "llama3.1:8b" -> 8)
    const match = modelName.match(/:(\d+(?:\.\d+)?)b/i);
    return match ? parseFloat(match[1]) : null;
}

function getHardwareRecommendation(modelName: string): {
    badge: string;
    color: string;
    tip: string;
} {
    const size = getModelSize(modelName);

    if (size === null) {
        return { badge: "", color: "", tip: "" };
    }

    if (size <= 7) {
        return {
            badge: "CPU OK",
            color: "green",
            tip: "Works well on CPU (no GPU needed)"
        };
    } else if (size <= 14) {
        return {
            badge: "GPU Recommended",
            color: "yellow",
            tip: "Runs on CPU but GPU recommended for better speed"
        };
    } else {
        return {
            badge: "GPU Required",
            color: "red",
            tip: "Very slow on CPU, GPU strongly recommended"
        };
    }
}

// ── component ──────────────────────────────────────────────────────────────────

export function SettingsModal({ open, onClose, onScopesChanged, plugins = [] }: Props) {
    // Core plugins (category === "core") get top-level settings tabs
    const corePluginsWithSettings = plugins.filter(p => p.category === "core" && p.SettingsSection);
    const [activeTab, setActiveTab] = useState<TabType>("appearance");
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
    const [pullError, setPullError] = useState<string | null>(null);
    const [modelError, setModelError] = useState<string | null>(null);
    const [ctxValue, setCtxValue] = useState(8192);
    const [ctxSaving, setCtxSaving] = useState(false);
    const [customInstructions, setCustomInstructions] = useState("");
    const [customInstructionsSaving, setCustomInstructionsSaving] = useState(false);
    const [webSearchEnabled, setWebSearchEnabled_] = useState(false);
    const customInstructionsTimerRef = useRef<number | null>(null);
    const [generatingDescription, setGeneratingDescription] = useState<string | null>(null);
    const [currentTheme, setCurrentTheme] = useState("blue-purple");
    const [currentLanguage, setCurrentLanguage] = useState("English");
    const [forceColorProfile, setForceColorProfile] = useState(true);
    const [ollamaUrl, setOllamaUrl] = useState("localhost:11434");
    const [ollamaError, setOllamaError] = useState("");
    const [ollamaSuccess, setOllamaSuccess] = useState(false);
    const { manifests: pluginManifests, togglePlugin } = usePluginManager();
    useEffect(() => {
        if (!open) return;
        getModels().then((data) => {
            setModels(data.models);
            setActiveModel(data.active);
        });
        getIndexStatus().then(setIndexStatus);
        getScopes().then(setLocalScopes);
        getCtx().then(setCtxValue).catch(() => {});
        getCustomInstructions().then(setCustomInstructions).catch(() => {});
        getWebSearchEnabled().then(setWebSearchEnabled_).catch(() => {});
        getTheme().then((theme) => {
            setCurrentTheme(theme);
            // Apply theme to document in case App.tsx hasn't loaded it yet
            document.documentElement.className = `theme-${theme}`;
        }).catch(() => {});
        getLanguage().then(setCurrentLanguage).catch(() => {});
        window.electronAPI?.getElectronPrefs().then((prefs: Record<string, unknown>) => {
            setForceColorProfile(prefs.forceColorProfile !== false);
        }).catch(() => {});
        getOllamaHostSetting()
            .then((data) => {
                if (data.mode === "local" || !data.external_url) {
                    setOllamaUrl("localhost:11434");
                } else {
                    setOllamaUrl(
                        data.external_url
                            .replace("http://", "")
                            .replace("https://", "")
                    );
                }
            })
            .catch(() => {
                setOllamaUrl("localhost:11434");
            });
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

    async function handleThemeChange(theme: string) {
        setCurrentTheme(theme);
        await setTheme(theme);
        // Update the theme class on the html element
        document.documentElement.className = `theme-${theme}`;
    }

    async function handleLanguageChange(language: string) {
        setCurrentLanguage(language);
        await setLanguage(language);
    }

    async function handleSaveOllamaHost(url: string) {
        try {
            setOllamaError("");
            setOllamaSuccess(false);
            await setOllamaHostSetting("external", url);
            setOllamaUrl(url);
            // Refresh models from the new host
            const data = await getModels();
            setModels(data.models);
            setActiveModel(data.active);
            // Show success message briefly
            setOllamaSuccess(true);
            setTimeout(() => setOllamaSuccess(false), 3000);
        } catch (error: any) {
            setOllamaError(error.message || "Failed to update Ollama host");
        }
    }

    async function handleModelChange(model: string) {
        setModelError(null);
        try {
            await setModel(model);
            setActiveModel(model);
        } catch (error) {
            console.error("Failed to set model:", error);
            const errorMsg = error instanceof Error ? error.message : String(error);
            setModelError(`Failed to set model: ${errorMsg}`);
            // Reload to get current state from backend
            const data = await getModels();
            setActiveModel(data.active);
        }
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

    function handleScopeDescriptionChange(name: string, description: string) {
        // Update local state immediately
        const updated = scopes.map((s) =>
            s.name === name ? { ...s, description } : s
        );
        setLocalScopes(updated);

        // Debounce the save
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

    async function handleGenerateDescription(name: string) {
        setGeneratingDescription(name);
        try {
            const description = await generateScopeDescription(name);

            // Update the scope with the generated description
            const updated = scopes.map((s) =>
                s.name === name ? { ...s, description } : s
            );
            setLocalScopes(updated);

            // Save immediately (no debounce for generated descriptions)
            const result = await setScopes(updated);
            setLocalScopes(result);
            onScopesChanged(result);
        } catch (error) {
            console.error(`Failed to generate description for ${name}:`, error);
            alert(`Failed to generate description: ${error}`);
        } finally {
            setGeneratingDescription(null);
        }
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
        setPullError(null);
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
            setPullError(null);
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : "Unknown error";
            setPullError(`Failed to pull model: ${errorMsg}`);
            setPullStatus(null);
            setPullInput(""); // Clear input on error
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

    // Close on Escape key
    useEffect(() => {
        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === "Escape" && open) {
                onClose();
            }
        };
        window.addEventListener("keydown", handleEscape);
        return () => window.removeEventListener("keydown", handleEscape);
    }, [open, onClose]);

    if (!open) return null;

    return (
        <>
            <div className="modal-backdrop" onClick={onClose} />
            <div className="settings-modal">
                <div className="modal-header">
                    <h2>Settings</h2>
                    <button className="close-btn" onClick={onClose}>
                        <X size={18} />
                    </button>
                </div>

                <div className="modal-tabs">
                    <button onClick={() => setActiveTab("about")} className={`tab ${activeTab === "about" ? "active" : ""}`}>
                        About
                    </button>
                    <button
                        className={`tab ${activeTab === "appearance" ? "active" : ""}`}
                        onClick={() => setActiveTab("appearance")}
                    >
                        Appearance
                    </button>
                    <button
                        className={`tab ${activeTab === "models" ? "active" : ""}`}
                        onClick={() => setActiveTab("models")}
                    >
                        Models
                    </button>
                    <button
                        className={`tab ${activeTab === "scopes" ? "active" : ""}`}
                        onClick={() => setActiveTab("scopes")}
                    >
                        Scopes
                    </button>
                    <button
                        className={`tab ${activeTab === "advanced" ? "active" : ""}`}
                        onClick={() => setActiveTab("advanced")}
                    >
                        Advanced
                    </button>
                    <button onClick={() => setActiveTab("plugins")} className={`tab ${activeTab === "plugins" ? "active" : ""}`}>
                        Plugins
                    </button>
                    {corePluginsWithSettings.map(plugin => (
                        <button
                            key={plugin.id}
                            className={`tab ${activeTab === plugin.id ? "active" : ""}`}
                            onClick={() => setActiveTab(plugin.id)}
                        >
                            {plugin.navItem?.label ?? plugin.name ?? plugin.id}
                        </button>
                    ))}
                </div>

                <div className="modal-content">
                    {activeTab === "appearance" && (
                        <>
                            <section className="drawer-section">
                                <h2>THEME</h2>
                                <div className="theme-pills">
                                    <button
                                        className={`theme-pill ${currentTheme === "shrimp" ? "active" : ""}`}
                                        onClick={() => handleThemeChange("shrimp")}
                                    >
                                        Shrimp
                                    </button>
                                    <button
                                        className={`theme-pill ${currentTheme === "blue-purple" ? "active" : ""}`}
                                        onClick={() => handleThemeChange("blue-purple")}
                                    >
                                        Purple
                                    </button>
                                    <button
                                        className={`theme-pill ${currentTheme === "refined-blue" ? "active" : ""}`}
                                        onClick={() => handleThemeChange("refined-blue")}
                                    >
                                        Blue
                                    </button>
                                </div>
                            </section>

                            {window.__shrimp__?.isElectron && (
                                <section className="drawer-section">
                                    <h2>DISPLAY</h2>
                                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem" }}>
                                        <div>
                                            <p style={{ margin: 0, fontSize: "0.85rem" }}>Force sRGB color profile</p>
                                            <p style={{ margin: "2px 0 0", fontSize: "0.75rem", color: "var(--text-muted)" }}>
                                                Prevents GTK theme from tinting window colors on Linux. Restart required.
                                            </p>
                                        </div>
                                        <button
                                            className={`toggle-btn ${forceColorProfile ? "on" : "off"}`}
                                            onClick={async () => {
                                                const next = !forceColorProfile;
                                                setForceColorProfile(next);
                                                await window.electronAPI?.setElectronPref("forceColorProfile", next);
                                            }}
                                        >
                                            {forceColorProfile ? "on" : "off"}
                                        </button>
                                    </div>
                                </section>
                            )}

                            <section className="drawer-section">
                                <h2>LANGUAGE</h2>
                                <div className="theme-pills">
                                    <button
                                        className={`theme-pill ${currentLanguage === "English" ? "active" : ""}`}
                                        onClick={() => handleLanguageChange("English")}
                                    >
                                        English
                                    </button>
                                    <button
                                        className={`theme-pill ${currentLanguage === "Spanish" ? "active" : ""}`}
                                        onClick={() => handleLanguageChange("Spanish")}
                                    >
                                        Spanish
                                    </button>
                                    <button
                                        className={`theme-pill ${currentLanguage === "French" ? "active" : ""}`}
                                        onClick={() => handleLanguageChange("French")}
                                    >
                                        French
                                    </button>
                                    <button
                                        className={`theme-pill ${currentLanguage === "German" ? "active" : ""}`}
                                        onClick={() => handleLanguageChange("German")}
                                    >
                                        German
                                    </button>
                                    <button
                                        className={`theme-pill ${currentLanguage === "Chinese" ? "active" : ""}`}
                                        onClick={() => handleLanguageChange("Chinese")}
                                    >
                                        Chinese
                                    </button>
                                    <button
                                        className={`theme-pill ${currentLanguage === "Japanese" ? "active" : ""}`}
                                        onClick={() => handleLanguageChange("Japanese")}
                                    >
                                        Japanese
                                    </button>
                                </div>
                            </section>
                        </>
                    )}

                    {activeTab === "models" && (
                        <>
                            <section className="drawer-section">
                                <h2>OLLAMA HOST</h2>
                                <p className="section-description">Configure where Ollama runs</p>
                                <div className="external-url-input">
                                    <label htmlFor="ollama-url" className="input-label">
                                        Ollama URL (host:port)
                                    </label>
                                    <div className="url-input-group">
                                        <input
                                            id="ollama-url"
                                            type="text"
                                            value={ollamaUrl}
                                            onChange={(e) => setOllamaUrl(e.target.value)}
                                            placeholder="localhost:11434"
                                            className="url-input"
                                        />
                                        <button
                                            className="save-url-btn"
                                            onClick={() => handleSaveOllamaHost(ollamaUrl)}
                                            disabled={!ollamaUrl.trim()}
                                        >
                                            Save
                                        </button>
                                    </div>
                                    {ollamaError && (
                                        <div className="error-message">{ollamaError}</div>
                                    )}
                                    {ollamaSuccess && (
                                        <div className="success-message">Connected successfully!</div>
                                    )}
                                </div>
                            </section>

                            <section className="drawer-section">
                                <h2>Model</h2>
                                <div className="model-list">
                                    {models.length === 0 && (
                                        <span className="scope-status unindexed">no models installed</span>
                                    )}
                                    {models.map((m) => {
                                        const hwInfo = getHardwareRecommendation(m);
                                        return (
                                            <div key={m} className="model-row">
                                                <button
                                                    className={`model-pill ${m === activeModel ? "active" : ""}`}
                                                    onClick={() => handleModelChange(m)}
                                                    title={hwInfo.tip || m}
                                                >
                                                    <span className="model-name">{m}</span>
                                                    {hwInfo.badge && (
                                                        <span className={`hw-badge hw-badge-${hwInfo.color}`}>
                                                            {hwInfo.badge}
                                                        </span>
                                                    )}
                                                </button>
                                                <button
                                                    className="delete-btn"
                                                    onClick={() => handleDeleteModel(m)}
                                                    title="Remove model"
                                                >
                                                    <X size={16} />
                                                </button>
                                            </div>
                                        );
                                    })}
                                </div>

                                {modelError && (
                                    <div style={{ marginTop: "0.4rem", color: "var(--color-error)", fontSize: "0.875rem" }}>
                                        {modelError}
                                    </div>
                                )}

                                <div className="add-scope" style={{ marginTop: "0.75rem" }}>
                                    <input
                                        placeholder="e.g. qwen2.5-coder:7b"
                                        value={pullInput}
                                        onChange={(e) => {
                                            setPullInput(e.target.value);
                                            setPullError(null); // Clear error when typing
                                        }}
                                        onKeyDown={(e) => e.key === "Enter" && handlePullModel()}
                                        disabled={pulling}
                                    />
                                    <button onClick={handlePullModel} disabled={pulling || !pullInput.trim()}>
                                        {pulling ? "pulling..." : "Pull"}
                                    </button>
                                </div>

                                {pullError && (
                                    <div style={{ marginTop: "0.4rem", color: "var(--color-error)", fontSize: "0.875rem" }}>
                                        {pullError}
                                    </div>
                                )}

                                {pullStatus && !pullError && (
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
                        </>
                    )}

                    {activeTab === "scopes" && (
                        <section className="drawer-section">
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
                                <h2 style={{ margin: 0 }}>Scopes {saving && <span className="saving">saving…</span>}</h2>
                                <button className="index-all" onClick={handleIndexAll} disabled={indexing !== null}>
                                    {indexing === "all" ? "indexing…" : <><RefreshCw size={16} />index all</>}
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
                                                {/* Header row with name/path and action buttons */}
                                                <div className="scope-header">
                                                    <div className="scope-main-info">
                                                        <span className="scope-name">{s.name}</span>
                                                        <span className="scope-path">{s.path}</span>
                                                    </div>
                                                    <div className="scope-actions">
                                                        <button
                                                            className="index-btn"
                                                            onClick={() => handleIndexOne(s.name)}
                                                            disabled={indexing !== null}
                                                        >
                                                            {indexing === s.name ? "…" : <RefreshCw size={14} />}
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

                                                {/* Status row */}
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

                                                {/* Description row */}
                                                <div style={{ width: '100%', marginTop: '0.5rem' }}>
                                                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
                                                        <textarea
                                                            value={s.description || ""}
                                                            onChange={(e) => handleScopeDescriptionChange(s.name, e.target.value)}
                                                            placeholder="Optional: Add a description for this scope (e.g., 'React/TypeScript frontend codebase')..."
                                                            rows={2}
                                                            style={{
                                                                flex: 1,
                                                                padding: '0.4rem',
                                                                borderRadius: '4px',
                                                                border: '1px solid var(--border)',
                                                                background: 'var(--bg)',
                                                                color: 'var(--text)',
                                                                fontFamily: 'inherit',
                                                                fontSize: '0.75rem',
                                                                resize: 'vertical'
                                                            }}
                                                        />
                                                        <button
                                                            onClick={() => handleGenerateDescription(s.name)}
                                                            disabled={indexing !== null || generatingDescription !== null}
                                                            style={{
                                                                padding: '0.4rem 0.75rem',
                                                                fontSize: '0.75rem',
                                                                whiteSpace: 'nowrap',
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                                gap: '0.25rem'
                                                            }}
                                                        >
                                                            {generatingDescription === s.name ? (
                                                                <><Loader2 size={16} className="spin" /> Generating...</>
                                                            ) : (
                                                                <><Sparkles size={16} /> Generate</>
                                                            )}
                                                        </button>
                                                    </div>
                                                </div>
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
                    )}

                    {activeTab === "advanced" && (
                        <>
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
                            <h2>Web Tools</h2>
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem" }}>
                                <div>
                                    <p style={{ margin: 0, fontSize: "0.85rem" }}>Web search &amp; fetch</p>
                                    <p style={{ margin: "2px 0 0", fontSize: "0.75rem", color: "var(--text-muted)" }}>
                                        Allow the AI to search the web and read URLs when answering questions.
                                    </p>
                                </div>
                                <button
                                    className={`toggle-btn ${webSearchEnabled ? "on" : "off"}`}
                                    onClick={async () => {
                                        const next = !webSearchEnabled;
                                        setWebSearchEnabled_(next);
                                        await setWebSearchEnabled(next).catch(() => setWebSearchEnabled_(!next));
                                    }}
                                >
                                    {webSearchEnabled ? "on" : "off"}
                                </button>
                            </div>
                        </section>
                        </>
                    )}

                    {activeTab === "about" && (
                        <section className="drawer-section">
                            <h2>ABOUT</h2>
                            <div className="scope-row">
                                <div className="scope-info">
                                    <span className="scope-name">SHRIMP*</span>
                                    <span className="scope-status">v{__APP_VERSION__}</span>
                                </div>
                            </div>
                        </section>
                    )}

                    {activeTab === "plugins" && (
                        <section className="drawer-section">
                            <h2>INSTALLED PLUGINS</h2>
                            <div className="scope-list">
                                {pluginManifests.map((manifest) => (
                                    <div key={manifest.id} className="scope-row">
                                        <div className="scope-info">
                                            <div className="scope-header">
                                                <div className="scope-main-info">
                                                    <span className="scope-name">
                                                        <Puzzle size={14} style={{ display: "inline", marginRight: "0.35rem", verticalAlign: "middle" }} />
                                                        {manifest.name}
                                                    </span>
                                                    <span className="scope-path">v{manifest.version} · {manifest.category ?? "core"}</span>
                                                </div>
                                                <div className="scope-actions">
                                                    <button
                                                        className={`toggle-btn ${manifest.enabled ? "on" : "off"}`}
                                                        onClick={() => togglePlugin(manifest.id, !manifest.enabled)}
                                                    >
                                                        {manifest.enabled ? "on" : "off"}
                                                    </button>
                                                </div>
                                            </div>
                                            {manifest.description && (
                                                <span className="scope-status">{manifest.description}</span>
                                            )}
                                        </div>
                                    </div>
                                ))}
                                {pluginManifests.length === 0 && (
                                    <span className="scope-status unindexed">no plugins installed</span>
                                )}
                            </div>
                            <div style={{ marginTop: "1.5rem", paddingTop: "1rem", borderTop: "1px solid var(--border)" }}>
                                <h2>PLUGIN STORE</h2>
                                <p style={{ margin: 0, fontSize: "0.8rem", color: "var(--text-muted)" }}>
                                    Browse and install community plugins — coming soon.
                                </p>
                            </div>
                        </section>
                    )}

                    {/* Plugin settings tabs */}
                    {corePluginsWithSettings.map(plugin => activeTab === plugin.id && plugin.SettingsSection && (
                        <plugin.SettingsSection key={plugin.id} />
                    ))}
                </div>
            </div>
        </>
    );
}
