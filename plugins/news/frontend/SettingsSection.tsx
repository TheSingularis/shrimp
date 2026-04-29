import { useState, useEffect } from "react";
import {
    getFeeds, saveFeeds, getInterests, saveInterests,
    type RssFeed, type FilterStrictness,
} from "./api";

const STRICTNESS_LABELS: Record<FilterStrictness, string> = {
    broad: "Broad",
    focused: "Focused",
    strict: "Strict",
};

const STRICTNESS_DESCRIPTIONS: Record<FilterStrictness, string> = {
    broad: "Tangentially related articles pass through.",
    focused: "Must be a clear primary topic, not just a passing mention.",
    strict: "Must be the central focus. Conservative — when in doubt, exclude.",
};

export function NewsSettingsSection() {
    const [feeds, setFeeds] = useState<RssFeed[]>([]);
    const [newFeedUrl, setNewFeedUrl] = useState("");
    const [newFeedName, setNewFeedName] = useState("");
    const [feedSaving, setFeedSaving] = useState(false);

    const [interests, setInterests] = useState("");
    const [strictness, setStrictness] = useState<FilterStrictness>("focused");
    const [interestsSaving, setInterestsSaving] = useState(false);

    useEffect(() => {
        getFeeds().then(setFeeds).catch(() => {});
        getInterests().then(d => {
            setInterests(d.interests);
            setStrictness(d.strictness);
        }).catch(() => {});
    }, []);

    async function addFeed() {
        if (!newFeedUrl.trim()) return;
        setFeedSaving(true);
        try {
            const updated = [...feeds, {
                url: newFeedUrl.trim(),
                name: newFeedName.trim() || newFeedUrl.trim(),
                enabled: true,
            }];
            setFeeds(updated);
            await saveFeeds(updated);
            setNewFeedUrl("");
            setNewFeedName("");
        } finally {
            setFeedSaving(false);
        }
    }

    async function toggleFeed(i: number) {
        const updated = feeds.map((f, j) => j === i ? { ...f, enabled: !f.enabled } : f);
        setFeeds(updated);
        await saveFeeds(updated);
    }

    async function removeFeed(i: number) {
        const updated = feeds.filter((_, j) => j !== i);
        setFeeds(updated);
        await saveFeeds(updated);
    }

    async function handleSaveInterests() {
        setInterestsSaving(true);
        try {
            await saveInterests({ interests, strictness });
        } finally {
            setInterestsSaving(false);
        }
    }

    return (
        <>
            <section className="drawer-section">
                <h2>RSS FEEDS</h2>
                <p style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginBottom: "0.75rem" }}>
                    News articles from these feeds appear in your Daily Focus checklist each morning.
                </p>

                <div className="scope-list" style={{ marginBottom: "0.75rem" }}>
                    {feeds.length === 0 && (
                        <p style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>No feeds configured.</p>
                    )}
                    {feeds.map((feed, i) => (
                        <div key={i} className="scope-row">
                            <div className="scope-header">
                                <div className="scope-main-info">
                                    <span className="scope-name">{feed.name || feed.url}</span>
                                    <span className="scope-path">{feed.url}</span>
                                </div>
                                <div className="scope-actions">
                                    <button
                                        className={`toggle-btn ${feed.enabled ? "on" : "off"}`}
                                        onClick={() => toggleFeed(i)}
                                    >
                                        {feed.enabled ? "on" : "off"}
                                    </button>
                                    <button
                                        className="delete-btn"
                                        title="Remove"
                                        onClick={() => removeFeed(i)}
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
                        onKeyDown={e => { if (e.key === "Enter" && newFeedUrl.trim()) addFeed(); }}
                    />
                    <button disabled={!newFeedUrl.trim() || feedSaving} onClick={addFeed}>
                        Add Feed
                    </button>
                </div>
            </section>

            <section className="drawer-section">
                <h2>YOUR INTERESTS</h2>
                <p style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginBottom: "0.75rem" }}>
                    Describe what topics you care about. The AI filters articles against this list each morning.
                </p>

                <textarea
                    value={interests}
                    onChange={e => setInterests(e.target.value)}
                    placeholder="e.g. US politics, AI research, climate policy, indie games..."
                    rows={3}
                    style={{ width: "100%", resize: "vertical", fontFamily: "inherit" }}
                />

                <div style={{ marginTop: "1rem" }}>
                    <label style={{ fontSize: "0.78rem", fontWeight: 600, color: "var(--text-muted)", letterSpacing: "0.05em", textTransform: "uppercase" }}>
                        Filter Strictness
                    </label>
                    <p style={{ fontSize: "0.78rem", color: "var(--text-muted)", margin: "0.35rem 0 0.5rem" }}>
                        {STRICTNESS_DESCRIPTIONS[strictness]}
                    </p>
                    <div style={{ display: "flex", gap: "0.4rem" }}>
                        {(["broad", "focused", "strict"] as FilterStrictness[]).map(level => (
                            <button
                                key={level}
                                className={`toggle-btn ${strictness === level ? "on" : ""}`}
                                onClick={() => setStrictness(level)}
                            >
                                {STRICTNESS_LABELS[level]}
                            </button>
                        ))}
                    </div>
                </div>

                <button
                    disabled={interestsSaving}
                    onClick={handleSaveInterests}
                    style={{ marginTop: "0.75rem" }}
                >
                    {interestsSaving ? "Saving…" : "Save Interests"}
                </button>
            </section>
        </>
    );
}
