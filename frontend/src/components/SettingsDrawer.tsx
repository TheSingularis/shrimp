import { useState, useEffect } from "react";
import { type Scope, getModels, setModel, setScopes, deleteScope } from "../api";
import { getIndexStatus, triggerIndexAll, triggerIndexOne, type IndexStatus } from "../api"
import { pullModel, deleteModel } from "../api";

interface Props {
    open: boolean;
    onClose: () => void;
    onScopesChanged: (scopes: Scope[]) => void;
}

export function SettingsDrawer({ open, onClose, onScopesChanged }: Props) {
    const [models, setModels] = useState<string[]>([]);
    const [activeModel, setActiveModel] = useState("");
    const [scopes, setLocalScopes] = useState<Scope[]>([]);
    const [newName, setNewName] = useState("");
    const [newPath, setNewPath] = useState("");
    const [saving, setSaving] = useState(false);
    const [indexStatus, setIndexStatus] = useState<IndexStatus[]>([]);
    const [indexing, setIndexing] = useState<string | null>(null);
    const [pullInput, setPullInput] = useState("");
    const [pulling, setPulling] = useState(false);
    const [pullStatus, setPullStatus] = useState<string | null>(null);
    const [pullPercent, setPullPercent] = useState<number | null>(null);

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
    }, [open]);

    async function handleModelChange(model: string) {
        setActiveModel(model);
        await setModel(model);
    }

    async function handleToggleScope(name: string) {
        const updated = scopes.map((s) =>
        s.name === name ? { ...s, enabled: !s.enabled }: s
        );
        setSaving(true);
        const result = await setScopes(updated);
        setLocalScopes(result);
        onScopesChanged(result);
        setSaving(false);
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

    async function handleIndexOne(name: string) {
        setIndexing(name);
        await triggerIndexOne(name);
        // poll until status updates
        const poll = setInterval(async () => {
            const status = await getIndexStatus();
            setIndexStatus(status);
            const s = status.find((x) => x.name === name);
            if (s?.last_indexed) {
                setIndexing(null);
                clearInterval(poll);
            }
        }, 1500);
    }

    async function handleIndexAll() {
        setIndexing("all");
        await triggerIndexAll();
        setTimeout(async () => {
            setIndexStatus(await getIndexStatus());
            setIndexing(null);
        }, 3000);
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
            setPullStatus("done")
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
            <div className="scope-status" style={{marginTop: "0.4rem"}}>
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
          <h2>Scopes {saving && <span className="saving">saving…</span>}</h2>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button onClick={handleIndexAll} disabled={indexing !== null}>
                {indexing === "all" ? "indexing…" : "↻ index all"}
            </button>
          </div>
          <div className="scope-list">
            {scopes.map((s) => (
              <div key={s.name} className="scope-row">
                <div className="scope-info">
                    <span className="scope-name">{s.name}</span>
                    <span className="scope-path">{s.path}</span>
                    {statusFor(s.name)?.last_indexed ? (
                    <span className="scope-status">
                        {statusFor(s.name)!.file_count} files · indexed {" "}
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
            ))}
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
