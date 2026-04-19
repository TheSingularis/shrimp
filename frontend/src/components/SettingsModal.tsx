import { useState, useEffect, useRef } from "react";
import { type Scope, getScopes, getModels, setModel, setScopes, deleteScope, getCtx, setCtx } from "../api";
import { getIndexStatus, triggerIndexAll, triggerIndexOne, type IndexStatus } from "../api"
import { pullModel, deleteModel } from "../api";
import { getCustomInstructions, setCustomInstructions, generateScopeDescription, getWebSearchEnabled, setWebSearchEnabled } from "../api";
import { getTheme, setTheme, getLanguage, setLanguage, getOllamaHostSetting, setOllamaHostSetting } from "../api";
import { getEmailConfig, saveEmailConfig, testEmailConfig, type EmailConfig,
         getSmtpConfig, saveSmtpConfig, testSmtpConfig, type SmtpConfig } from "../api";
import { getRssFeeds, saveRssFeeds } from "../api";
import { X, RefreshCw, Sparkles, Loader2 } from "lucide-react";
import "./SettingsModal.css";

const BASE = import.meta.env.VITE_API_URL ?? `http://${window.location.hostname || 'localhost'}:8000`;

interface Props {
    open: boolean;
    onClose: () => void;
    onScopesChanged: (scopes: Scope[]) => void;
}

type TabType = "appearance" | "models" | "scopes" | "advanced" | "email" | "automations";

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

export function SettingsModal({ open, onClose, onScopesChanged }: Props) {
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
    const [ollamaMode, setOllamaMode] = useState<"local" | "external">("local");
    const [externalUrl, setExternalUrl] = useState("");
    const [ollamaError, setOllamaError] = useState("");
    const [ollamaSuccess, setOllamaSuccess] = useState(false);
    const [emailConfig, setEmailConfig] = useState<EmailConfig>({
        enabled: false, imap_host: "", imap_port: 993, imap_ssl: true,
        username: "", password: "", mailbox: "INBOX", fetch_max: 50, poll_interval_minutes: 15,
    });
    const [emailSaving, setEmailSaving] = useState(false);
    const [emailTesting, setEmailTesting] = useState(false);
    const [emailTestResult, setEmailTestResult] = useState<{ success: boolean; message: string } | null>(null);
    const [smtpConfig, setSmtpConfig] = useState<SmtpConfig>({
        enabled: false, smtp_host: "", smtp_port: 587, smtp_ssl: false, smtp_starttls: true,
        username: "", password: "", from_name: "", from_email: "",
    });
    const [smtpSaving, setSmtpSaving] = useState(false);
    const [smtpTesting, setSmtpTesting] = useState(false);
    const [smtpTestResult, setSmtpTestResult] = useState<{ success: boolean; message: string } | null>(null);
    const [rssFeeds, setRssFeeds] = useState<{ url: string; name: string; enabled: boolean }[]>([]);
    const [newFeedUrl, setNewFeedUrl] = useState("");
    const [newFeedName, setNewFeedName] = useState("");
    const [rssSaving, setRssSaving] = useState(false);

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
        getOllamaHostSetting()
            .then((data) => {
                setOllamaMode(data.mode);
                const displayUrl = data.external_url
                    .replace("http://", "")
                    .replace("https://", "");
                setExternalUrl(displayUrl);
            })
            .catch(() => {
                setOllamaMode("local");
            });
        getEmailConfig().then(setEmailConfig).catch(() => {});
        getSmtpConfig().then(setSmtpConfig).catch(() => {});
    }, [open]);

    useEffect(() => {
        if (activeTab === "automations") {
            getRssFeeds().then(setRssFeeds).catch(() => {});
        }
    }, [activeTab]);

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

    async function handleSaveOllamaHost(mode: "local" | "external", url: string) {
        try {
            setOllamaError("");
            setOllamaSuccess(false);
            await setOllamaHostSetting(mode, url);
            setOllamaMode(mode);
            if (mode === "external") {
                setExternalUrl(url);
            }
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
                    <button
                        className={`tab ${activeTab === "email" ? "active" : ""}`}
                        onClick={() => setActiveTab("email")}
                    >
                        Email
                    </button>
                    <button onClick={() => setActiveTab("automations")} className={`tab ${activeTab === "automations" ? "active" : ""}`}>
                        Automations
                    </button>
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
                                <div className="theme-pills">
                                    <button
                                        className={`theme-pill ${ollamaMode === "local" ? "active" : ""}`}
                                        onClick={() => handleSaveOllamaHost("local", "")}
                                    >
                                        Local (Managed)
                                    </button>
                                    <button
                                        className={`theme-pill ${ollamaMode === "external" ? "active" : ""}`}
                                        onClick={() => setOllamaMode("external")}
                                    >
                                        External (Custom)
                                    </button>
                                </div>

                                {ollamaMode === "external" && (
                                    <div className="external-url-input">
                                        <label htmlFor="ollama-url" className="input-label">
                                            Ollama URL (host:port)
                                        </label>
                                        <div className="url-input-group">
                                            <input
                                                id="ollama-url"
                                                type="text"
                                                value={externalUrl}
                                                onChange={(e) => setExternalUrl(e.target.value)}
                                                placeholder="192.168.1.100:11434"
                                                className="url-input"
                                            />
                                            <button
                                                className="save-url-btn"
                                                onClick={() => handleSaveOllamaHost("external", externalUrl)}
                                                disabled={!externalUrl.trim()}
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
                                        <div className="help-text">
                                            Example: 192.168.1.100:11434 for a networked Ollama instance
                                        </div>
                                    </div>
                                )}
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

                    {activeTab === "email" && (
                        <>
                            <section className="drawer-section">
                                <h2>IMAP CONFIGURATION</h2>
                                <p style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginBottom: "0.75rem" }}>
                                    Credentials are stored locally in config.py and never leave your machine.
                                </p>

                                <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
                                    <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.85rem" }}>
                                        <input
                                            type="checkbox"
                                            checked={emailConfig.enabled}
                                            onChange={e => setEmailConfig(c => ({ ...c, enabled: e.target.checked }))}
                                        />
                                        Enable email integration
                                    </label>

                                    {[
                                        { label: "IMAP Host", key: "imap_host", type: "text", placeholder: "imap.gmail.com" },
                                        { label: "Port", key: "imap_port", type: "number", placeholder: "993" },
                                        { label: "Username / Email", key: "username", type: "email", placeholder: "you@example.com" },
                                        { label: "Password / App password", key: "password", type: "password", placeholder: "••••••••" },
                                        { label: "Mailbox", key: "mailbox", type: "text", placeholder: "INBOX" },
                                        { label: "Max emails per fetch", key: "fetch_max", type: "number", placeholder: "50" },
                                        { label: "Poll interval (minutes)", key: "poll_interval_minutes", type: "number", placeholder: "15" },
                                    ].map(({ label, key, type, placeholder }) => (
                                        <div key={key}>
                                            <label style={{ fontSize: "0.75rem", color: "var(--text-muted)", display: "block", marginBottom: "0.2rem" }}>
                                                {label}
                                            </label>
                                            <input
                                                type={type}
                                                value={String((emailConfig as Record<string, unknown>)[key] ?? "")}
                                                onChange={e => setEmailConfig(c => ({ ...c, [key]: type === "number" ? parseInt(e.target.value) || 0 : e.target.value }))}
                                                placeholder={placeholder}
                                                style={{
                                                    width: "100%", padding: "0.4rem 0.5rem",
                                                    borderRadius: "4px", border: "1px solid var(--border)",
                                                    background: "var(--bg)", color: "var(--text)",
                                                    fontSize: "0.85rem",
                                                }}
                                            />
                                        </div>
                                    ))}

                                    <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.85rem" }}>
                                        <input
                                            type="checkbox"
                                            checked={emailConfig.imap_ssl}
                                            onChange={e => setEmailConfig(c => ({ ...c, imap_ssl: e.target.checked }))}
                                        />
                                        Use SSL
                                    </label>
                                </div>

                                <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem", flexWrap: "wrap" }}>
                                    <button
                                        className="scope-action-btn"
                                        disabled={emailTesting}
                                        onClick={async () => {
                                            setEmailTesting(true);
                                            setEmailTestResult(null);
                                            try {
                                                const result = await testEmailConfig();
                                                setEmailTestResult(result);
                                            } catch {
                                                setEmailTestResult({ success: false, message: "Request failed" });
                                            } finally {
                                                setEmailTesting(false);
                                            }
                                        }}
                                    >
                                        {emailTesting ? "Testing…" : "Test Connection"}
                                    </button>
                                    <button
                                        className="scope-action-btn"
                                        disabled={emailSaving}
                                        onClick={async () => {
                                            setEmailSaving(true);
                                            try {
                                                await saveEmailConfig(emailConfig);
                                            } finally {
                                                setEmailSaving(false);
                                            }
                                        }}
                                    >
                                        {emailSaving ? "Saving…" : "Save"}
                                    </button>
                                </div>

                                {emailTestResult && (
                                    <p style={{ fontSize: "0.8rem", marginTop: "0.5rem", color: emailTestResult.success ? "var(--accent)" : "var(--color-error, #ef4444)" }}>
                                        {emailTestResult.success ? "✓" : "✗"} {emailTestResult.message}
                                    </p>
                                )}
                            </section>

                            <section className="drawer-section">
                                <h2>SMTP CONFIGURATION</h2>
                                <p style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginBottom: "0.75rem" }}>
                                    Required for sending emails (compose, reply, forward).
                                </p>

                                <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
                                    <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.85rem" }}>
                                        <input
                                            type="checkbox"
                                            checked={smtpConfig.enabled}
                                            onChange={e => setSmtpConfig(c => ({ ...c, enabled: e.target.checked }))}
                                        />
                                        Enable sending
                                    </label>

                                    {[
                                        { label: "SMTP Host", key: "smtp_host", type: "text", placeholder: "smtp.gmail.com" },
                                        { label: "Port", key: "smtp_port", type: "number", placeholder: "587" },
                                        { label: "Username / Email", key: "username", type: "email", placeholder: "you@example.com" },
                                        { label: "Password / App password", key: "password", type: "password", placeholder: "••••••••" },
                                        { label: "From name (optional)", key: "from_name", type: "text", placeholder: "Your Name" },
                                        { label: "From email (optional, defaults to username)", key: "from_email", type: "email", placeholder: "you@example.com" },
                                    ].map(({ label, key, type, placeholder }) => (
                                        <div key={key}>
                                            <label style={{ fontSize: "0.75rem", color: "var(--text-muted)", display: "block", marginBottom: "0.2rem" }}>
                                                {label}
                                            </label>
                                            <input
                                                type={type}
                                                value={String((smtpConfig as Record<string, unknown>)[key] ?? "")}
                                                onChange={e => setSmtpConfig(c => ({ ...c, [key]: type === "number" ? parseInt(e.target.value) || 0 : e.target.value }))}
                                                placeholder={placeholder}
                                                style={{
                                                    width: "100%", padding: "0.4rem 0.5rem",
                                                    borderRadius: "4px", border: "1px solid var(--border)",
                                                    background: "var(--bg)", color: "var(--text)",
                                                    fontSize: "0.85rem",
                                                }}
                                            />
                                        </div>
                                    ))}

                                    <div style={{ display: "flex", gap: "1rem" }}>
                                        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.85rem" }}>
                                            <input
                                                type="checkbox"
                                                checked={smtpConfig.smtp_starttls}
                                                onChange={e => setSmtpConfig(c => ({ ...c, smtp_starttls: e.target.checked, smtp_ssl: e.target.checked ? false : c.smtp_ssl }))}
                                            />
                                            STARTTLS
                                        </label>
                                        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.85rem" }}>
                                            <input
                                                type="checkbox"
                                                checked={smtpConfig.smtp_ssl}
                                                onChange={e => setSmtpConfig(c => ({ ...c, smtp_ssl: e.target.checked, smtp_starttls: e.target.checked ? false : c.smtp_starttls }))}
                                            />
                                            SSL/TLS (port 465)
                                        </label>
                                    </div>
                                </div>

                                <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem" }}>
                                    <button
                                        className="scope-action-btn"
                                        disabled={smtpTesting || smtpSaving}
                                        onClick={async () => {
                                            setSmtpTesting(true);
                                            setSmtpTestResult(null);
                                            try {
                                                await saveSmtpConfig(smtpConfig);
                                                setSmtpTestResult(await testSmtpConfig());
                                            } catch {
                                                setSmtpTestResult({ success: false, message: "Request failed" });
                                            } finally {
                                                setSmtpTesting(false);
                                            }
                                        }}
                                    >
                                        {smtpTesting ? "Testing…" : "Test Connection"}
                                    </button>
                                    <button
                                        className="scope-action-btn"
                                        disabled={smtpSaving}
                                        onClick={async () => {
                                            setSmtpSaving(true);
                                            setSmtpTestResult(null);
                                            try {
                                                await saveSmtpConfig(smtpConfig);
                                                setSmtpTestResult({ success: true, message: "Settings saved." });
                                            } catch {
                                                setSmtpTestResult({ success: false, message: "Failed to save." });
                                            } finally {
                                                setSmtpSaving(false);
                                            }
                                        }}
                                    >
                                        {smtpSaving ? "Saving…" : "Save"}
                                    </button>
                                </div>

                                {smtpTestResult && (
                                    <p style={{ fontSize: "0.8rem", marginTop: "0.5rem", color: smtpTestResult.success ? "var(--accent)" : "var(--color-error, #ef4444)" }}>
                                        {smtpTestResult.success ? "✓" : "✗"} {smtpTestResult.message}
                                    </p>
                                )}
                            </section>
                        </>
                    )}
                    {activeTab === "automations" && (
                        <section className="drawer-section">
                            <h2>RSS FEEDS</h2>
                            <p style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginBottom: "0.75rem" }}>
                                News articles from these feeds appear in your Daily Focus checklist each morning.
                            </p>

                            <div className="scope-list" style={{ marginBottom: "0.75rem" }}>
                                {rssFeeds.length === 0 && (
                                    <p style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>No feeds configured.</p>
                                )}
                                {rssFeeds.map((feed, i) => (
                                    <div key={i} className="scope-row">
                                        <div className="scope-header">
                                            <div className="scope-main-info">
                                                <span className="scope-name">{feed.name || feed.url}</span>
                                                <span className="scope-path">{feed.url}</span>
                                            </div>
                                            <div className="scope-actions">
                                                <button
                                                    className={`toggle-btn ${feed.enabled ? "on" : "off"}`}
                                                    onClick={async () => {
                                                        const updated = rssFeeds.map((f, j) => j === i ? { ...f, enabled: !f.enabled } : f);
                                                        setRssFeeds(updated);
                                                        await saveRssFeeds(updated);
                                                    }}
                                                >
                                                    {feed.enabled ? "on" : "off"}
                                                </button>
                                                <button
                                                    className="delete-btn"
                                                    title="Remove"
                                                    onClick={async () => {
                                                        const updated = rssFeeds.filter((_, j) => j !== i);
                                                        setRssFeeds(updated);
                                                        await saveRssFeeds(updated);
                                                    }}
                                                >
                                                    ✕
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            <div className="add-scope">
                                <input
                                    type="text"
                                    placeholder="Feed name (e.g. Hacker News)"
                                    value={newFeedName}
                                    onChange={e => setNewFeedName(e.target.value)}
                                />
                                <input
                                    type="url"
                                    placeholder="Feed URL (RSS or Atom)"
                                    value={newFeedUrl}
                                    onChange={e => setNewFeedUrl(e.target.value)}
                                    onKeyDown={async e => {
                                        if (e.key === "Enter" && newFeedUrl.trim()) {
                                            const updated = [...rssFeeds, { url: newFeedUrl.trim(), name: newFeedName.trim() || newFeedUrl.trim(), enabled: true }];
                                            setRssFeeds(updated);
                                            await saveRssFeeds(updated);
                                            setNewFeedUrl("");
                                            setNewFeedName("");
                                        }
                                    }}
                                />
                                <button
                                    disabled={!newFeedUrl.trim() || rssSaving}
                                    onClick={async () => {
                                        if (!newFeedUrl.trim()) return;
                                        setRssSaving(true);
                                        try {
                                            const updated = [...rssFeeds, { url: newFeedUrl.trim(), name: newFeedName.trim() || newFeedUrl.trim(), enabled: true }];
                                            setRssFeeds(updated);
                                            await saveRssFeeds(updated);
                                            setNewFeedUrl("");
                                            setNewFeedName("");
                                        } finally {
                                            setRssSaving(false);
                                        }
                                    }}
                                >
                                    Add Feed
                                </button>
                            </div>
                        </section>
                    )}
                </div>
            </div>
        </>
    );
}
