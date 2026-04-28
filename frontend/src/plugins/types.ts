/**
 * Frontend plugin contract for SHRIMP.
 *
 * Each plugin's frontend/index.tsx must export a default object satisfying
 * ShrimpPluginFrontend. The plugin loader discovers these via import.meta.glob
 * and makes them available through PluginContext.
 */

import type React from "react";

/** Function signature used by plugins to navigate to another panel or open an email/conversation. */
export type NavigateFn = (
    panel: string,
    emailId?: string,
    conversationId?: string,
) => void;

/** Describes the nav-rail entry provided by a plugin. */
export interface PluginNavItem {
    /** Lucide icon component (or any React node component). */
    Icon: React.ComponentType<{ size?: number }>;
    label: string;
    /**
     * Optional React hook that returns the current badge count.
     * Rendered in a dedicated per-plugin component so hook rules are satisfied.
     * Example: `useBadge: useEmailUnreadCount`
     */
    useBadge?: () => number;
}

/** Params passed to a plugin panel when navigating to it. */
export type PanelParams = Record<string, string>;

/** Full frontend plugin registration object. */
export interface ShrimpPluginFrontend {
    /** Must match the id in plugin.json. */
    id: string;
    /** "core" plugins render their SettingsSection as a top-level tab.
     *  "community" plugins appear under the shared Plugins tab. */
    category?: "core" | "community";
    /** Nav rail entry. If omitted the plugin has no top-level panel. */
    navItem?: PluginNavItem;
    /** Main panel rendered when the plugin's nav item is active. */
    PanelComponent?: React.ComponentType<{ onNavigate: NavigateFn; params?: PanelParams }>;
    /** Zero or more dashboard card components rendered in DashboardHome. */
    DashboardCards?: React.ComponentType<{ onNavigate: NavigateFn }>[];
    /** Settings section rendered inside the settings modal. */
    SettingsSection?: React.ComponentType;
}
