/**
 * Email plugin — frontend registration.
 *
 * Exports a default ShrimpPluginFrontend object that the plugin loader
 * picks up via import.meta.glob.
 */

import { Mail } from "lucide-react";
import type { ShrimpPluginFrontend, NavigateFn, PanelParams } from "@core/plugins/types";
import { EmailPanel } from "./EmailPanel";
import { EmailSettingsSection } from "./SettingsSection";
import { EmailDashboardCard, FlaggedDashboardCard, useEmailUnreadCount } from "./DashboardCards";

// ── Panel wrapper ──────────────────────────────────────────────────────────────
// Bridges plugin PanelComponent interface (onNavigate + params) to EmailPanel's
// own props (initialEmailId, onEmailOpened).

function EmailPanelWrapper({ params }: { onNavigate: NavigateFn; params?: PanelParams }) {
    const initialEmailId = params?.emailId ?? null;
    return (
        <EmailPanel
            initialEmailId={initialEmailId}
            // EmailPanel clears the selection after opening; no callback needed here
        />
    );
}

// ── Plugin registration ────────────────────────────────────────────────────────

const emailPlugin: ShrimpPluginFrontend = {
    id: "email",
    name: "Email",
    category: "core",

    navItem: {
        Icon: Mail,
        label: "Email",
        useBadge: useEmailUnreadCount,
    },

    PanelComponent: EmailPanelWrapper,

    DashboardCards: [FlaggedDashboardCard, EmailDashboardCard],

    SettingsSection: EmailSettingsSection,
};

export default emailPlugin;
