import { useEffect, useState } from "react";
import { BookOpen, Search, RefreshCw, FileText, AlertTriangle, Tag, ExternalLink } from "lucide-react";
import { listObsidianPages, getObsidianPage, searchObsidian, type ObsidianPage, type ObsidianPageFull } from "../api";

// ── Helpers ───────────────────────────────────────────────────────────────────

function relativeModified(ts: number) {
    const diff = Date.now() - ts * 1000;
    const days = Math.floor(diff / 86400000);
    if (days === 0) return "today";
    if (days === 1) return "yesterday";
    if (days < 7) return `${days}d ago`;
    return new Date(ts * 1000).toLocaleDateString();
}

function folderOf(path: string) {
    const i = path.lastIndexOf("/");
    return i === -1 ? "" : path.slice(0, i);
}

// ── Page row ──────────────────────────────────────────────────────────────────

function PageRow({ page, active, onClick }: { page: ObsidianPage; active: boolean; onClick: () => void }) {
    return (
        <button
            onClick={onClick}
            className={`w-full flex items-start gap-2.5 px-3 py-2.5 border-b border-shrimp-border text-left transition-colors ${
                active ? "bg-shrimp-surface" : "hover:bg-shrimp-surface/60"
            }`}
        >
            <FileText size={13} className="shrink-0 mt-0.5" style={{ color: 'var(--accent)' }} />
            <div className="flex-1 min-w-0">
                <p className="text-sm truncate">{page.title}</p>
                {folderOf(page.path) && (
                    <p className="text-[10px] truncate mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
                        {folderOf(page.path)}
                    </p>
                )}
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    {page.tags.slice(0, 3).map(t => (
                        <span key={t} className="inline-flex items-center gap-0.5 text-[9px] px-1 rounded"
                            style={{ background: 'var(--accent)20', color: 'var(--accent)' }}>
                            <Tag size={7} /> {t}
                        </span>
                    ))}
                    <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
                        {relativeModified(page.modified)}
                    </span>
                </div>
            </div>
        </button>
    );
}

// ── Page detail ───────────────────────────────────────────────────────────────

function PageDetail({ page, onClose }: { page: ObsidianPageFull; onClose: () => void }) {
    return (
        <div className="flex flex-col flex-1 overflow-hidden">
            {/* Header */}
            <div className="shrink-0 flex items-center justify-between gap-3 px-4 py-3 border-b border-shrimp-border">
                <div className="flex-1 min-w-0">
                    <h2 className="font-semibold text-sm truncate">{page.title}</h2>
                    <p className="text-[10px] truncate mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
                        {page.path}
                    </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    {page.broken_links.length > 0 && (
                        <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded"
                            style={{ background: 'var(--color-warning-bg, rgba(245,158,11,0.1))', color: 'var(--color-warning, #f59e0b)' }}>
                            <AlertTriangle size={10} />
                            {page.broken_links.length} broken link{page.broken_links.length > 1 ? "s" : ""}
                        </span>
                    )}
                    <button
                        onClick={onClose}
                        className="text-[11px] px-2 py-1 rounded hover:bg-shrimp-border/50 transition-colors"
                        style={{ color: 'var(--color-text-muted)' }}
                    >
                        ✕
                    </button>
                </div>
            </div>

            {/* Tags */}
            {page.frontmatter && Object.keys(page.frontmatter).length > 0 && (
                <div className="shrink-0 flex flex-wrap gap-1.5 px-4 py-2 border-b border-shrimp-border">
                    {Object.entries(page.frontmatter).map(([k, v]) => (
                        <span key={k} className="text-[10px] px-1.5 py-0.5 rounded border border-shrimp-border"
                            style={{ color: 'var(--color-text-muted)' }}>
                            <strong>{k}:</strong> {v}
                        </span>
                    ))}
                </div>
            )}

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-4">
                <pre className="text-sm whitespace-pre-wrap font-mono leading-relaxed" style={{ color: 'var(--color-text)' }}>
                    {page.body || "(empty)"}
                </pre>
            </div>

            {/* Broken links warning */}
            {page.broken_links.length > 0 && (
                <div className="shrink-0 px-4 py-2 border-t border-shrimp-border"
                    style={{ background: 'var(--color-warning-bg, rgba(245,158,11,0.08))' }}>
                    <p className="text-xs" style={{ color: 'var(--color-warning, #f59e0b)' }}>
                        <AlertTriangle size={11} className="inline mr-1" />
                        Broken wikilinks: {page.broken_links.map(l => `[[${l}]]`).join(", ")}
                    </p>
                </div>
            )}
        </div>
    );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export function ObsidianPanel() {
    const [pages, setPages] = useState<ObsidianPage[]>([]);
    const [scopeName, setScopeName] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [selectedPath, setSelectedPath] = useState<string | null>(null);
    const [selectedPage, setSelectedPage] = useState<ObsidianPageFull | null>(null);
    const [loadingDetail, setLoadingDetail] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [searchResults, setSearchResults] = useState<string | null>(null);
    const [searching, setSearching] = useState(false);
    const [mobileDetail, setMobileDetail] = useState(false);

    useEffect(() => {
        loadPages();
    }, []);

    async function loadPages() {
        setLoading(true);
        try {
            const data = await listObsidianPages();
            setPages(data.pages);
            setScopeName(data.scope);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    }

    async function handleSelect(path: string) {
        if (!scopeName) return;
        setSelectedPath(path);
        setMobileDetail(true);
        setLoadingDetail(true);
        setSearchResults(null);
        try {
            const full = await getObsidianPage(scopeName, path);
            setSelectedPage(full);
        } catch (e) {
            console.error(e);
        } finally {
            setLoadingDetail(false);
        }
    }

    async function handleSearch(e: React.FormEvent) {
        e.preventDefault();
        if (!searchQuery.trim()) return;
        setSearching(true);
        setSelectedPage(null);
        setSelectedPath(null);
        setMobileDetail(true);
        try {
            const data = await searchObsidian(searchQuery.trim(), scopeName ?? undefined);
            setSearchResults(data.results);
        } catch (e) {
            console.error(e);
            setSearchResults("Search failed.");
        } finally {
            setSearching(false);
        }
    }

    // Filtered pages by search input (client-side title filter only; semantic search is separate)
    const filtered = searchQuery
        ? pages.filter(p =>
            p.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
            p.path.toLowerCase().includes(searchQuery.toLowerCase()) ||
            p.tags.some(t => t.toLowerCase().includes(searchQuery.toLowerCase()))
        )
        : pages;

    const noVault = !loading && pages.length === 0 && !scopeName;

    return (
        <div className="flex flex-col flex-1 overflow-hidden">
            {/* Mobile detail overlay */}
            {mobileDetail && (selectedPage || searchResults !== null) && (
                <div className="flex flex-col flex-1 overflow-hidden md:hidden">
                    {searchResults !== null ? (
                        <div className="flex flex-col flex-1 overflow-hidden">
                            <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-shrimp-border">
                                <span className="text-sm font-medium">Search Results</span>
                                <button onClick={() => { setMobileDetail(false); setSearchResults(null); }}
                                    className="text-xs px-2 py-1 rounded hover:bg-shrimp-border/50"
                                    style={{ color: 'var(--color-text-muted)' }}>✕</button>
                            </div>
                            <div className="flex-1 overflow-y-auto p-4">
                                <pre className="text-sm whitespace-pre-wrap leading-relaxed">{searchResults}</pre>
                            </div>
                        </div>
                    ) : selectedPage ? (
                        <PageDetail page={selectedPage} onClose={() => { setMobileDetail(false); setSelectedPage(null); }} />
                    ) : null}
                </div>
            )}

            {/* Main layout */}
            <div className={`flex flex-1 overflow-hidden ${mobileDetail ? "hidden md:flex" : "flex"}`}>
                {/* Left pane: page list */}
                <div className="flex flex-col w-full md:w-72 lg:w-80 shrink-0 border-r border-shrimp-border overflow-hidden">
                    {/* Header */}
                    <div className="shrink-0 flex items-center justify-between px-3 py-3 border-b border-shrimp-border">
                        <div className="flex items-center gap-2">
                            <BookOpen size={14} style={{ color: 'var(--accent)' }} />
                            <span className="font-semibold text-sm">Vault</span>
                            {scopeName && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded border border-shrimp-border"
                                    style={{ color: 'var(--color-text-muted)' }}>{scopeName}</span>
                            )}
                        </div>
                        <div className="flex items-center gap-1">
                            {pages.length > 0 && (
                                <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
                                    {pages.length} notes
                                </span>
                            )}
                            <button onClick={loadPages} disabled={loading}
                                className="p-1.5 rounded hover:bg-shrimp-border/50 transition-colors disabled:opacity-50"
                                style={{ color: 'var(--accent)' }} title="Refresh">
                                <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
                            </button>
                        </div>
                    </div>

                    {/* Search bar */}
                    <form onSubmit={handleSearch} className="shrink-0 flex items-center gap-1 px-3 py-2 border-b border-shrimp-border">
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            placeholder="Filter or semantic search…"
                            className="flex-1 text-xs bg-transparent outline-none placeholder:opacity-50"
                            style={{ color: 'var(--color-text)' }}
                        />
                        <button type="submit" disabled={searching || !searchQuery.trim()}
                            className="icon-btn"
                            style={{ color: 'var(--accent)' }} title="Semantic search">
                            <Search size={13} className={searching ? "animate-spin" : ""} />
                        </button>
                    </form>

                    {/* Page list */}
                    <div className="flex-1 overflow-y-auto">
                        {loading ? (
                            <p className="text-sm p-4" style={{ color: 'var(--color-text-muted)' }}>Loading…</p>
                        ) : noVault ? (
                            <div className="p-4 text-center">
                                <BookOpen size={32} className="mx-auto mb-2" style={{ color: 'var(--color-text-muted)' }} />
                                <p className="text-sm font-medium">No vault configured</p>
                                <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
                                    Add a scope named "obsidian" in Settings → Scopes.
                                </p>
                            </div>
                        ) : filtered.length === 0 ? (
                            <p className="text-sm p-4" style={{ color: 'var(--color-text-muted)' }}>No notes match.</p>
                        ) : (
                            filtered.map(p => (
                                <PageRow
                                    key={p.path}
                                    page={p}
                                    active={p.path === selectedPath}
                                    onClick={() => handleSelect(p.path)}
                                />
                            ))
                        )}
                    </div>
                </div>

                {/* Right pane: detail (desktop) */}
                <div className="hidden md:flex flex-col flex-1 overflow-hidden">
                    {loadingDetail ? (
                        <div className="flex items-center justify-center h-full">
                            <RefreshCw size={20} className="animate-spin" style={{ color: 'var(--color-text-muted)' }} />
                        </div>
                    ) : searchResults !== null ? (
                        <div className="flex flex-col flex-1 overflow-hidden">
                            <div className="shrink-0 px-4 py-3 border-b border-shrimp-border flex items-center justify-between">
                                <span className="text-sm font-semibold">Search Results</span>
                                <button onClick={() => { setSearchResults(null); setSelectedPath(null); }}
                                    className="text-xs px-2 py-1 rounded hover:bg-shrimp-border/50"
                                    style={{ color: 'var(--color-text-muted)' }}>✕</button>
                            </div>
                            <div className="flex-1 overflow-y-auto p-4">
                                <pre className="text-sm whitespace-pre-wrap leading-relaxed">{searchResults}</pre>
                            </div>
                        </div>
                    ) : selectedPage ? (
                        <PageDetail page={selectedPage} onClose={() => { setSelectedPath(null); setSelectedPage(null); }} />
                    ) : (
                        <div className="flex flex-col items-center justify-center h-full gap-2">
                            <BookOpen size={40} style={{ color: 'var(--color-text-muted)' }} />
                            <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
                                Select a note to read it
                            </p>
                            {pages.length > 0 && (
                                <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                                    {pages.length} note{pages.length !== 1 ? "s" : ""} in vault
                                </p>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
