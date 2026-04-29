/**
 * News plugin — frontend registration.
 *
 * Settings-only plugin: no nav panel or dashboard cards.
 * Provides RSS feed management and interest-based article filtering settings.
 */

import type { ShrimpPluginFrontend } from "@core/plugins/types";
import { NewsSettingsSection } from "./SettingsSection";

const newsPlugin: ShrimpPluginFrontend = {
    id: "news",
    name: "News",
    category: "core",
    SettingsSection: NewsSettingsSection,
};

export default newsPlugin;
