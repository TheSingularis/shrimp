/**
 * React context that makes the loaded plugin list available throughout the app.
 *
 * Usage:
 *   // in App.tsx (or main.tsx)
 *   <PluginProvider><App /></PluginProvider>
 *
 *   // anywhere inside the tree
 *   const plugins = usePlugins();
 */

import { createContext, useContext, useEffect, useState } from "react";
import type { ShrimpPluginFrontend } from "./types";
import { loadPlugins } from "./loader";

const PluginContext = createContext<ShrimpPluginFrontend[]>([]);

const BASE = import.meta.env.VITE_API_URL ?? `http://${window.location.hostname || "localhost"}:8000`;

export function PluginProvider({ children }: { children: React.ReactNode }) {
    const [plugins, setPlugins] = useState<ShrimpPluginFrontend[]>([]);

    useEffect(() => {
        fetch(`${BASE}/api/plugins`)
            .then((r) => r.json())
            .then(async (data: { plugins: { id: string }[] }) => {
                const ids = data.plugins.map((p) => p.id);
                const loaded = await loadPlugins(ids);
                setPlugins(loaded);
            })
            .catch((err) => {
                console.warn("[plugins] Failed to fetch plugin list:", err);
            });
    }, []);

    return (
        <PluginContext.Provider value={plugins}>
            {children}
        </PluginContext.Provider>
    );
}

/** Returns the array of currently loaded frontend plugins. */
export function usePlugins(): ShrimpPluginFrontend[] {
    return useContext(PluginContext);
}
