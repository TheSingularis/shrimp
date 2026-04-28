import type { ShrimpPluginFrontend } from "./types";

// frontend/plugins is a symlink to ../plugins (repo root), keeping the path
// within the Vite root for both dev and production builds.
// Generic type parameter omitted — rolldown's OXC parser doesn't handle
// import.meta.glob<{...}> reliably; use a type assertion instead.
const pluginModules = import.meta.glob("../../plugins/*/frontend/index.tsx") as Record<
    string,
    () => Promise<{ default: ShrimpPluginFrontend }>
>;

export async function loadPlugins(ids: string[]): Promise<ShrimpPluginFrontend[]> {
    const results: ShrimpPluginFrontend[] = [];
    for (const id of ids) {
        const key = `../../plugins/${id}/frontend/index.tsx`;
        const loader = pluginModules[key];
        if (!loader) continue;
        try {
            const mod = await loader();
            results.push(mod.default);
        } catch (err) {
            console.error(`[plugins] Failed to load frontend for plugin '${id}':`, err);
        }
    }
    return results;
}
