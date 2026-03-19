import { useState, useEffect } from "react";
import { getScopes, type Scope } from "./api";
import { ChatPanel } from "./components/ChatPanel";
import { ScopeSelector } from "./components/ScopeSelector";
import { SettingsDrawer } from "./components/SettingsDrawer"
import "./index.css";

export default function App() {
    const [scopes, setScopes] = useState<Scope[]>([]);
    const [selectedScopes, setSelectedScopes] = useState<string[]>([]);
    const [settingsOpen, setSettingsOpen] = useState(false);

    useEffect(() => {
        getScopes().then((data) => {
            setScopes(data);
            // default: select all enabled scopes
            setSelectedScopes(data.filter((s) => s.enabled).map((s) => s.name));
        });
    }, []);

    function handleScopesChanged(updated: Scope[]) {
        setScopes(updated);
        setSelectedScopes(updated.filter((s) => s.enabled).map((s) => s.name))
    }

    return (
        <div className="app">
            <header>
                <h1>SHRIMP<span className="asterisk">*</span></h1>
                <ScopeSelector
                    scopes={scopes}
                    selected={selectedScopes}
                    onChange={setSelectedScopes}
                />
                <button className="settings-btn" onClick={() => setSettingsOpen(true)}>
                    ⚙
                </button>
            </header>
            <main>
                <ChatPanel scopes={selectedScopes} />
            </main>

            <SettingsDrawer
                open={settingsOpen}
                onClose={() => setSettingsOpen(false)}
                onScopesChanged={handleScopesChanged}
            />
        </div>
    );
}
