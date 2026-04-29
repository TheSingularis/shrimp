const BASE = import.meta.env.VITE_API_URL ?? `http://${window.location.hostname || 'localhost'}:8000`;

export interface RssFeed {
    url: string;
    name: string;
    enabled: boolean;
}

export async function getFeeds(): Promise<RssFeed[]> {
    const res = await fetch(`${BASE}/plugins/news/feeds`);
    if (!res.ok) throw new Error("Failed to get RSS feeds");
    const data = await res.json();
    return data.feeds || [];
}

export async function saveFeeds(feeds: RssFeed[]): Promise<void> {
    const res = await fetch(`${BASE}/plugins/news/feeds`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feeds }),
    });
    if (!res.ok) throw new Error("Failed to save RSS feeds");
}

export type FilterStrictness = "broad" | "focused" | "strict";

export interface InterestsConfig {
    interests: string;
    strictness: FilterStrictness;
}

export async function getInterests(): Promise<InterestsConfig> {
    const res = await fetch(`${BASE}/plugins/news/interests`);
    if (!res.ok) throw new Error("Failed to get interests");
    return res.json();
}

export async function saveInterests(cfg: InterestsConfig): Promise<void> {
    const res = await fetch(`${BASE}/plugins/news/interests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cfg),
    });
    if (!res.ok) throw new Error("Failed to save interests");
}
