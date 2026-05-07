/**
 * React context that makes the loaded plugin list available throughout the app.
 *
 * Usage:
 *   // in App.tsx (or main.tsx)
 *   <PluginProvider><App /></PluginProvider>
 *
 *   // anywhere inside the tree
 *   const plugins = usePlugins();
 *   const { manifests, togglePlugin } = usePluginManager(); // settings only
 */

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ShrimpPluginFrontend } from "./types";
import type { PluginManifest } from "../api";
import { setPluginEnabled } from "../api";
import { loadPlugins } from "./loader";

interface PluginManagerValue {
    manifests: PluginManifest[];
    togglePlugin: (id: string, enabled: boolean) => Promise<void>;
    restartPending: boolean;
    clearRestartPending: () => void;
}

const PluginContext = createContext<ShrimpPluginFrontend[]>([]);
const PluginManagerContext = createContext<PluginManagerValue>({
    manifests: [],
    togglePlugin: async () => {},
    restartPending: false,
    clearRestartPending: () => {},
});

const BASE = import.meta.env.VITE_API_URL ?? `http://${window.location.hostname || "localhost"}:8000`;

export function PluginProvider({ children }: { children: React.ReactNode }) {
    const [allPlugins, setAllPlugins] = useState<ShrimpPluginFrontend[]>([]);
    const [manifests, setManifests] = useState<PluginManifest[]>([]);
    const [restartPending, setRestartPending] = useState(false);

    useEffect(() => {
        fetch(`${BASE}/api/plugins`)
            .then((r) => r.json())
            .then(async (data: { plugins: PluginManifest[] }) => {
                setManifests(data.plugins);
                // Load ALL plugin modules upfront — browser caches them, so
                // toggling enabled state is a pure in-memory operation (no reload).
                const allIds = data.plugins.map((p) => p.id);
                const loaded = await loadPlugins(allIds);
                setAllPlugins(loaded);
            })
            .catch((err) => {
                console.warn("[plugins] Failed to fetch plugin list:", err);
            });
    }, []);

    const enabledIds = useMemo(
        () => new Set(manifests.filter((m) => m.enabled !== false).map((m) => m.id)),
        [manifests],
    );

    const enabledPlugins = useMemo(
        () => allPlugins.filter((p) => enabledIds.has(p.id)),
        [allPlugins, enabledIds],
    );

    async function togglePlugin(id: string, enabled: boolean) {
        const manifest = manifests.find((m) => m.id === id);
        // Optimistic update
        setManifests((prev) => prev.map((m) => (m.id === id ? { ...m, enabled } : m)));
        try {
            await setPluginEnabled(id, enabled);
            if (manifest?.has_backend) setRestartPending(true);
        } catch {
            // Rollback
            setManifests((prev) => prev.map((m) => (m.id === id ? { ...m, enabled: !enabled } : m)));
        }
    }

    const managerValue = useMemo<PluginManagerValue>(
        () => ({ manifests, togglePlugin, restartPending, clearRestartPending: () => setRestartPending(false) }),
        [manifests, restartPending],
    );

    return (
        <PluginManagerContext.Provider value={managerValue}>
            <PluginContext.Provider value={enabledPlugins}>
                {children}
            </PluginContext.Provider>
        </PluginManagerContext.Provider>
    );
}

/** Returns only the currently enabled plugins. */
export function usePlugins(): ShrimpPluginFrontend[] {
    return useContext(PluginContext);
}

/** Returns manifests (all plugins + enabled state) and a toggle function. */
export function usePluginManager(): PluginManagerValue {
    return useContext(PluginManagerContext);
}
