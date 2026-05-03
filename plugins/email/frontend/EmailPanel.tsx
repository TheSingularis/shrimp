import { useEffect, useRef, useState } from "react";
import { RefreshCw, Mail, MailOpen, Star, Search, X, Pencil, ChevronDown, CheckSquare, Archive, Trash2, ShieldAlert } from "lucide-react";

/** Strip "The email / This email" opener from AI triage notes. */
function cleanTriageNote(note: string | undefined, maxLen = 90): string | undefined {
    if (!note) return undefined;
    let clean = note.replace(/^(the email|this email)\s*/i, "").trim();
    clean = clean.charAt(0).toUpperCase() + clean.slice(1);
    return clean.length > maxLen ? clean.slice(0, maxLen - 1) + "…" : clean;
}
import { getInbox, fetchInbox, fetchFolder, getFolders, searchEmails, getEmail, setEmailFlag, setEmailRead, archiveEmail, trashEmail, junkEmail, getTriageStatus, type EmailMeta, type EmailFull, type TriageStatus, type EmailFolder } from "./api";
import { EmailDetail } from "./EmailDetail";
import { ComposeModal } from "./ComposeModal";
import { senderName, relativeTime } from "@core/utils/email";
import { URGENCY_CONFIG, type UrgencyLevel } from "@core/utils/urgency";

// ── Context menu ───────────────────────────────────────────────────────────────

interface ContextMenuProps {
    x: number;
    y: number;
    label: string; // e.g. "3 emails" or sender name
    isRead: boolean; // for the mark read/unread label (single) or majority state (bulk)
    isFlagged: boolean;
    onClose: () => void;
    onMarkRead: () => void;
    onMarkUnread: () => void;
    onFlag: () => void;
    onUnflag: () => void;
    onArchive: () => void;
    onJunk: () => void;
    onTrash: () => void;
}

function ContextMenu({ x, y, label, isRead, isFlagged, onClose, onMarkRead, onMarkUnread, onFlag, onUnflag, onArchive, onJunk, onTrash }: ContextMenuProps) {
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        function handler(e: MouseEvent) {
            if (ref.current && !ref.current.contains(e.target as Node)) onClose();
        }
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, [onClose]);

    const menuStyle: React.CSSProperties = {
        position: "fixed",
        top: y,
        left: x,
        zIndex: 200,
        background: "var(--surface)",
        border: "1px solid var(--color-border)",
        borderRadius: 8,
        boxShadow: "0 8px 24px rgba(0,0,0,0.45)",
        minWidth: 175,
        overflow: "hidden",
        padding: "4px 0",
    };

    const headerStyle: React.CSSProperties = {
        padding: "5px 14px 6px",
        fontSize: 11,
        color: "var(--color-text-muted)",
        borderBottom: "1px solid var(--color-border)",
        marginBottom: 4,
        userSelect: "none",
    };

    const itemStyle: React.CSSProperties = {
        display: "flex",
        alignItems: "center",
        gap: 8,
        width: "100%",
        padding: "7px 14px",
        fontSize: 12,
        textAlign: "left",
        background: "transparent",
        border: "none",
        cursor: "pointer",
        color: "var(--color-text)",
    };

    const dangerStyle: React.CSSProperties = { ...itemStyle, color: "var(--color-danger, #ef4444)" };

    function act(fn: () => void) { fn(); onClose(); }

    return (
        <div ref={ref} style={menuStyle} onContextMenu={e => e.preventDefault()}>
            <div style={headerStyle}>{label}</div>
            <button style={itemStyle} onClick={() => act(isRead ? onMarkUnread : onMarkRead)}>
                {isRead ? <Mail size={12} /> : <MailOpen size={12} />}
                {isRead ? "Mark as unread" : "Mark as read"}
            </button>
            <button style={{ ...itemStyle, color: isFlagged ? undefined : undefined }} onClick={() => act(isFlagged ? onUnflag : onFlag)}>
                <Star size={12} fill={isFlagged ? "#f59e0b" : "none"} style={{ color: isFlagged ? "#f59e0b" : "var(--color-text)", flexShrink: 0 }} />
                {isFlagged ? "Unflag" : "Flag"}
            </button>
            <div style={{ borderTop: "1px solid var(--color-border)", margin: "4px 0" }} />
            <button style={itemStyle} onClick={() => act(onArchive)}>
                <Archive size={12} />
                Archive
            </button>
            <button style={dangerStyle} onClick={() => act(onJunk)}>
                <ShieldAlert size={12} />
                Mark as junk
            </button>
            <button style={dangerStyle} onClick={() => act(onTrash)}>
                <Trash2 size={12} />
                Move to trash
            </button>
        </div>
    );
}

// ── Email row ─────────────────────────────────────────────────────────────────

function EmailRow({ em, active, selected, onClick, onFlag, triageStatus, onContextMenu }: {
    em: EmailMeta; active: boolean; selected: boolean; onClick: (e: React.MouseEvent) => void;
    onFlag: (id: string, flagged: boolean) => void;
    triageStatus: TriageStatus | null;
    onContextMenu: (e: React.MouseEvent, em: EmailMeta) => void;
}) {
    const urgency = em.triage_priority ?? "";
    const urgencyCfg = URGENCY_CONFIG[urgency as UrgencyLevel];
    const urgencyAccent = urgencyCfg?.color && (urgency === "urgent" || urgency === "high") ? urgencyCfg.color : undefined;

    const leftBorderColor = selected
        ? "var(--accent)"
        : active
            ? "var(--theme-primary)"
            : em.flagged
                ? (em.read ? "color-mix(in srgb, #f59e0b 45%, transparent)" : "#f59e0b")
                : urgencyAccent
                    ? (em.read ? `color-mix(in srgb, ${urgencyAccent} 35%, transparent)` : urgencyAccent)
                    : (!em.read ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.07)");

    const bgColor = selected
        ? "color-mix(in srgb, var(--accent) 14%, var(--surface))"
        : active
            ? "color-mix(in srgb, var(--theme-primary) 10%, var(--surface))"
            : "var(--surface)";

    return (
        <div
            className="flex items-start email-item"
            style={{
                borderLeft: `3px solid ${leftBorderColor}`,
                background: bgColor,
                transition: "background 0.12s",
            }}
            onContextMenu={e => onContextMenu(e, em)}
        >
            <button
                onClick={onClick}
                className="btn-row flex-1 min-w-0 flex items-start gap-3"
            >
                <div className="flex-1 min-w-0">
                    {/* Sender + time */}
                    <div className="flex items-baseline justify-between gap-2 mb-0.5">
                        <span className={`text-sm truncate ${!em.read ? "font-semibold" : "font-medium"}`}>
                            {senderName(em.from)}
                        </span>
                        <span className="text-[10px] shrink-0" style={{ color: 'var(--color-text-muted)' }}>
                            {relativeTime(em.date)}
                        </span>
                    </div>
                    {/* Subject + priority badge on same row */}
                    <div className="flex items-center justify-between gap-2 mb-0.5">
                        <p className="text-xs truncate flex-1" style={{
                            color: !em.read ? 'var(--color-text)' : 'var(--color-text-muted)'
                        }}>
                            {em.subject || "(no subject)"}
                        </p>
                        {/* Priority badge — only for urgent/high */}
                        {urgencyAccent && urgencyCfg && (
                            <span
                                className="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded"
                                style={{ color: urgencyAccent, background: urgencyCfg.bg }}
                            >
                                {urgencyCfg.label}
                            </span>
                        )}
                    </div>
                    {/* Triage note — cleaned of "The email / This email" prefix */}
                    {/* TODO: fix the triage prompt to use the correct prefix, just trimming it is still messy, some messages start with  */}
                    {cleanTriageNote(em.triage_note) ? (
                        <p className="text-[11px] truncate" style={{ color: 'var(--color-text-muted)', opacity: 0.7 }}>
                            {cleanTriageNote(em.triage_note)}
                        </p>
                    ) : !em.triaged ? (
                        <p className="text-[11px] italic triage-label" style={{ color: 'var(--color-text-muted)' }}>
                            {triageStatus?.active
                                ? `Triaging ${triageStatus.done}/${triageStatus.total}…`
                                : "Pending triage…"}
                        </p>
                    ) : null}
                </div>
            </button>

            {/* Flag/star button */}
            {/* <button
                onClick={(e) => { e.stopPropagation(); onFlag(em.id, !em.flagged); }}
                className="shrink-0 self-center p-2 rounded transition-colors hover:bg-shrimp-border/50"
                title={em.flagged ? "Unflag" : "Flag"}
                style={{
                    background: "transparent",
                    border: "none",
                    color: em.flagged ? "#f59e0b" : "var(--color-text-muted)",
                    opacity: em.flagged ? 1 : 0.4,
                }}
            >
                <Star size={13} fill={em.flagged ? "#f59e0b" : "none"} />
            </button> */}
        </div>
    );
}

// ── Bulk action bar ───────────────────────────────────────────────────────────

function BulkActionBar({ count, onMarkRead, onMarkUnread, onArchive, onJunk, onTrash, onFlag, onUnflag, onClear }: {
    count: number;
    onMarkRead: () => void;
    onMarkUnread: () => void;
    onArchive: () => void;
    onJunk: () => void;
    onTrash: () => void;
    onFlag: () => void;
    onUnflag: () => void;
    onClear: () => void;
}) {
    return (
        <div className="shrink-0 flex items-center gap-1 px-2 py-1.5 border-b border-shrimp-border"
            style={{ background: "color-mix(in srgb, var(--accent) 8%, var(--surface))" }}>
            <CheckSquare size={12} style={{ color: "var(--accent)", flexShrink: 0, marginRight: 2 }} />
            <span className="text-xs font-semibold" style={{ color: "var(--accent)", marginRight: 4, whiteSpace: "nowrap" }}>
                {count}
            </span>
            <button className="btn-ghost" onClick={onMarkRead} title="Mark as read" style={{ padding: "4px 6px" }}>
                <MailOpen size={13} />
            </button>
            <button className="btn-ghost" onClick={onMarkUnread} title="Mark as unread" style={{ padding: "4px 6px" }}>
                <Mail size={13} />
            </button>
            <button className="btn-ghost" onClick={onFlag} title="Flag" style={{ padding: "4px 6px", color: "#f59e0b" }}>
                <Star size={13} fill="#f59e0b" />
            </button>
            <button className="btn-ghost" onClick={onUnflag} title="Unflag" style={{ padding: "4px 6px", opacity: 0.5 }}>
                <Star size={13} />
            </button>
            <button className="btn-ghost" onClick={onArchive} title="Archive" style={{ padding: "4px 6px" }}>
                <Archive size={13} />
            </button>
            <button className="btn-ghost danger" onClick={onJunk} title="Mark as junk" style={{ padding: "4px 6px" }}>
                <ShieldAlert size={13} />
            </button>
            <button className="btn-ghost danger" onClick={onTrash} title="Trash" style={{ padding: "4px 6px" }}>
                <Trash2 size={13} />
            </button>
            <button className="btn-ghost" onClick={onClear} title="Clear selection" style={{ marginLeft: "auto", padding: "4px 6px" }}>
                <X size={13} />
            </button>
        </div>
    );
}

// ── Panel ─────────────────────────────────────────────────────────────────────

interface EmailPanelProps {
    initialEmailId?: string | null;
    onEmailOpened?: () => void;
}

const FOLDERS_CACHE_KEY = "shrimp_email_folders";
const DEFAULT_FOLDERS: EmailFolder[] = [{ imap_name: "INBOX", display_name: "Inbox", role: "inbox" }];
function loadCachedFolders(): EmailFolder[] {
    try {
        const raw = localStorage.getItem(FOLDERS_CACHE_KEY);
        return raw ? (JSON.parse(raw) as EmailFolder[]) : DEFAULT_FOLDERS;
    } catch { return DEFAULT_FOLDERS; }
}

export function EmailPanel({ initialEmailId, onEmailOpened }: EmailPanelProps = {}) {
    const [emails, setEmails] = useState<EmailMeta[]>([]);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [selectedEmail, setSelectedEmail] = useState<EmailFull | null>(null);
    const [loading, setLoading] = useState(true);
    const [fetching, setFetching] = useState(false);
    const [mobileDetail, setMobileDetail] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [searchResults, setSearchResults] = useState<EmailMeta[] | null>(null);
    const [searching, setSearching] = useState(false);
    const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [folders, setFolders] = useState<EmailFolder[]>(loadCachedFolders);
    const [activeFolder, setActiveFolder] = useState<string>("Inbox");
    const activeFolderRef = useRef<string>("Inbox");
    const [openGroup, setOpenGroup] = useState<"sent" | "filed" | null>(null);
    const [composing, setComposing] = useState(false);
    const [composeInitial, setComposeInitial] = useState<{ to?: string; subject?: string; body?: string; cc?: string }>({});
    const [triageStatus, setTriageStatus] = useState<TriageStatus | null>(null);
    const triagePollerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const prevActiveRef = useRef(false);

    // Multi-select state
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const lastClickedIndexRef = useRef<number>(-1);

    // Context menu state
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number; email: EmailMeta; isBulk: boolean } | null>(null);

    const hasUntriaged = emails.some(e => !e.triaged);

    // Poll triage status only while untriaged emails exist
    useEffect(() => {
        if (!hasUntriaged) {
            if (triagePollerRef.current) { clearInterval(triagePollerRef.current); triagePollerRef.current = null; }
            setTriageStatus(null);
            return;
        }
        if (triagePollerRef.current) return;
        const poll = async () => { try { setTriageStatus(await getTriageStatus()); } catch {} };
        poll();
        triagePollerRef.current = setInterval(poll, 3000);
        return () => { if (triagePollerRef.current) { clearInterval(triagePollerRef.current); triagePollerRef.current = null; } };
    }, [hasUntriaged]);

    // Auto-refresh inbox when a triage batch completes
    useEffect(() => {
        if (!triageStatus) return;
        if (prevActiveRef.current && !triageStatus.active) refresh();
        prevActiveRef.current = triageStatus.active;
    }, [triageStatus]);

    // Load folder list once on mount; persist to localStorage so next mount is instant
    useEffect(() => {
        getFolders().then(result => {
            setFolders(result);
            localStorage.setItem(FOLDERS_CACHE_KEY, JSON.stringify(result));
        }).catch(console.error);
    }, []);

    useEffect(() => {
        activeFolderRef.current = activeFolder;
        const folder = activeFolder;
        const activeRole = folders.find(f => f.display_name === folder)?.role ?? "folder";
        refresh(folder).then(() => {
            // Auto-sync non-inbox folders on first visit when empty
            if (activeRole !== "inbox") {
                setEmails(prev => {
                    if (prev.length === 0) {
                        setFetching(true);
                        fetchFolder(folder, 100)
                            .then(() => refresh(folder))
                            .catch(console.error)
                            .finally(() => setFetching(false));
                    }
                    return prev;
                });
            }
        });
        // Clear selection when folder changes
        setSelectedIds(new Set());
        lastClickedIndexRef.current = -1;
    }, [activeFolder]);

    // Open a specific email when directed from another panel
    useEffect(() => {
        if (initialEmailId && !loading) {
            handleSelect(initialEmailId);
            onEmailOpened?.();
        }
    }, [initialEmailId, loading]);

    // Auto-refresh the active folder every 30s to pick up background sync changes
    useEffect(() => {
        const id = setInterval(() => {
            if (!loading && !fetching) refresh(activeFolderRef.current);
        }, 30_000);
        return () => clearInterval(id);
    }, []);

    // Refresh list when any individual email is triaged
    useEffect(() => {
        const handler = () => refresh(activeFolderRef.current);
        window.addEventListener("email:triage-complete", handler);
        return () => window.removeEventListener("email:triage-complete", handler);
    }, []);

    // Close context menu on scroll or click elsewhere
    useEffect(() => {
        if (!contextMenu) return;
        function handler() { setContextMenu(null); }
        document.addEventListener("scroll", handler, true);
        return () => document.removeEventListener("scroll", handler, true);
    }, [contextMenu]);

    async function refresh(folder = activeFolder) {
        setLoading(true);
        try {
            const result = await getInbox(100, folder);
            if (activeFolderRef.current === folder) {
                setEmails(result);
            }
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    }

    async function handleFetch() {
        setFetching(true);
        try {
            const result = await fetchInbox();
            if (result.fetched > 0) await refresh();
        } catch (e) {
            console.error(e);
        } finally {
            setFetching(false);
        }
    }

    async function handleSelect(id: string) {
        setSelectedId(id);
        setMobileDetail(true);
        try {
            const full = await getEmail(id);
            setSelectedEmail(full);
            setEmails(prev => prev.map(e => e.id === id ? { ...e, read: true } : e));
            window.dispatchEvent(new CustomEvent('email:read-changed'));
            setEmailRead(id, true).catch(() => {});
        } catch (e) {
            console.error(e);
        }
    }

    function handleRowClick(e: React.MouseEvent, id: string, index: number) {
        const displayedEmails = searchResults ?? emails;

        if (e.ctrlKey || e.metaKey) {
            // Ctrl+click: toggle this email in selection
            e.preventDefault();
            setSelectedIds(prev => {
                const next = new Set(prev);
                // Auto-include the open email when starting a fresh selection
                if (next.size === 0 && selectedId && selectedId !== id) next.add(selectedId);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                return next;
            });
            lastClickedIndexRef.current = index;
        } else if (e.shiftKey && lastClickedIndexRef.current >= 0) {
            // Shift+click: range select
            e.preventDefault();
            const from = Math.min(lastClickedIndexRef.current, index);
            const to = Math.max(lastClickedIndexRef.current, index);
            setSelectedIds(prev => {
                const next = new Set(prev);
                // Auto-include the open email when starting a fresh selection
                if (next.size === 0 && selectedId) next.add(selectedId);
                for (let i = from; i <= to; i++) {
                    next.add(displayedEmails[i].id);
                }
                return next;
            });
        } else {
            // Plain click: clear selection, open email
            setSelectedIds(new Set());
            lastClickedIndexRef.current = index;
            handleSelect(id);
        }
    }

    async function handleFlag(id: string, flagged: boolean) {
        setEmails(prev => prev.map(e => e.id === id ? { ...e, flagged } : e));
        if (selectedEmail?.id === id) {
            setSelectedEmail(prev => prev ? { ...prev, flagged } : prev);
        }
        try {
            await setEmailFlag(id, flagged);
        } catch (e) {
            console.error(e);
            setEmails(prev => prev.map(e => e.id === id ? { ...e, flagged: !flagged } : e));
        }
    }

    // Single-email actions (used by context menu)
    async function handleMarkRead(id: string, read: boolean) {
        setEmails(prev => prev.map(e => e.id === id ? { ...e, read } : e));
        try { await setEmailRead(id, read); window.dispatchEvent(new CustomEvent('email:read-changed')); } catch (e) { console.error(e); }
    }

    async function handleArchiveSingle(id: string) {
        try {
            await archiveEmail(id);
            setEmails(prev => prev.filter(e => e.id !== id));
            if (selectedId === id) { setSelectedId(null); setSelectedEmail(null); }
        } catch (e) { console.error(e); }
    }

    async function handleTrashSingle(id: string) {
        try {
            await trashEmail(id);
            setEmails(prev => prev.filter(e => e.id !== id));
            if (selectedId === id) { setSelectedId(null); setSelectedEmail(null); }
        } catch (e) { console.error(e); }
    }

    async function handleJunkSingle(id: string) {
        try {
            await junkEmail(id);
            setEmails(prev => prev.filter(e => e.id !== id));
            if (selectedId === id) { setSelectedId(null); setSelectedEmail(null); }
        } catch (e) { console.error(e); }
    }

    // Bulk action helpers
    async function bulkMarkRead(read: boolean) {
        const ids = [...selectedIds];
        setEmails(prev => prev.map(e => ids.includes(e.id) ? { ...e, read } : e));
        setSelectedIds(new Set());
        await Promise.allSettled(ids.map(id => setEmailRead(id, read)));
        window.dispatchEvent(new CustomEvent('email:read-changed'));
    }

    async function bulkFlag() {
        const ids = [...selectedIds];
        setEmails(prev => prev.map(e => ids.includes(e.id) ? { ...e, flagged: true } : e));
        setSelectedIds(new Set());
        await Promise.allSettled(ids.map(id => setEmailFlag(id, true)));
    }

    async function bulkUnflag() {
        const ids = [...selectedIds];
        setEmails(prev => prev.map(e => ids.includes(e.id) ? { ...e, flagged: false } : e));
        setSelectedIds(new Set());
        await Promise.allSettled(ids.map(id => setEmailFlag(id, false)));
    }

    async function bulkArchive() {
        const ids = [...selectedIds];
        setEmails(prev => prev.filter(e => !ids.includes(e.id)));
        if (selectedId && ids.includes(selectedId)) { setSelectedId(null); setSelectedEmail(null); }
        setSelectedIds(new Set());
        await Promise.allSettled(ids.map(id => archiveEmail(id)));
    }

    async function bulkTrash() {
        const ids = [...selectedIds];
        setEmails(prev => prev.filter(e => !ids.includes(e.id)));
        if (selectedId && ids.includes(selectedId)) { setSelectedId(null); setSelectedEmail(null); }
        setSelectedIds(new Set());
        await Promise.allSettled(ids.map(id => trashEmail(id)));
    }

    async function bulkJunk() {
        const ids = [...selectedIds];
        setEmails(prev => prev.filter(e => !ids.includes(e.id)));
        if (selectedId && ids.includes(selectedId)) { setSelectedId(null); setSelectedEmail(null); }
        setSelectedIds(new Set());
        await Promise.allSettled(ids.map(id => junkEmail(id)));
    }

    function handleSearchChange(q: string) {
        setSearchQuery(q);
        if (searchDebounce.current) clearTimeout(searchDebounce.current);
        if (!q.trim()) {
            setSearchResults(null);
            return;
        }
        searchDebounce.current = setTimeout(async () => {
            setSearching(true);
            try {
                setSearchResults(await searchEmails(q.trim()));
            } catch (e) {
                console.error(e);
            } finally {
                setSearching(false);
            }
        }, 300);
    }

    function handleMove(id: string, _folder: string) {
        setEmails(prev => prev.filter(e => e.id !== id));
        if (selectedId === id) {
            setSelectedId(null);
            setSelectedEmail(null);
        }
    }

    function clearSearch() {
        setSearchQuery("");
        setSearchResults(null);
    }

    function handleContextMenu(e: React.MouseEvent, em: EmailMeta) {
        e.preventDefault();
        const isBulk = selectedIds.size > 1 && selectedIds.has(em.id);
        setContextMenu({ x: e.clientX, y: e.clientY, email: em, isBulk });
    }

    const displayedEmails = searchResults ?? emails;
    const unreadCount = emails.filter(e => !e.read).length;

    return (
        <div className="flex flex-col flex-1 overflow-hidden">
            {composing && <ComposeModal
                initial={composeInitial}
                onClose={() => setComposing(false)}
                onSent={() => {
                    const sentFolder = folders.find(f => f.role === "sent");
                    if (sentFolder) {
                        fetchFolder(sentFolder.display_name, 50)
                            .then(() => refresh(sentFolder.display_name))
                            .catch(() => {});
                    }
                }}
            />}

            {/* Context menu */}
            {contextMenu && (() => {
                const { x, y, email, isBulk } = contextMenu;
                const close = () => setContextMenu(null);
                if (isBulk) {
                    const sel = displayedEmails.filter(e => selectedIds.has(e.id));
                    const half = sel.length / 2;
                    return <ContextMenu
                        x={x} y={y}
                        label={`${selectedIds.size} emails`}
                        isRead={sel.filter(e => e.read).length > half}
                        isFlagged={sel.filter(e => e.flagged).length > half}
                        onClose={close}
                        onMarkRead={bulkMarkRead.bind(null, true)}
                        onMarkUnread={bulkMarkRead.bind(null, false)}
                        onFlag={bulkFlag}
                        onUnflag={bulkUnflag}
                        onArchive={bulkArchive}
                        onJunk={bulkJunk}
                        onTrash={bulkTrash}
                    />;
                }
                return <ContextMenu
                    x={x} y={y}
                    label={senderName(email.from)}
                    isRead={email.read}
                    isFlagged={email.flagged ?? false}
                    onClose={close}
                    onMarkRead={() => handleMarkRead(email.id, true)}
                    onMarkUnread={() => handleMarkRead(email.id, false)}
                    onFlag={() => handleFlag(email.id, true)}
                    onUnflag={() => handleFlag(email.id, false)}
                    onArchive={() => handleArchiveSingle(email.id)}
                    onJunk={() => handleJunkSingle(email.id)}
                    onTrash={() => handleTrashSingle(email.id)}
                />;
            })()}

            {/* Mobile: full-screen detail */}
            {mobileDetail && selectedEmail && (
                <div className="flex flex-col flex-1 overflow-hidden md:hidden">
                    <EmailDetail key={selectedEmail.id} email={selectedEmail} onBack={() => setMobileDetail(false)} onFlag={handleFlag} onCompose={initial => { setComposeInitial(initial); setComposing(true); }} onMove={handleMove} />
                </div>
            )}

            <div className={`flex flex-1 overflow-hidden ${mobileDetail ? "hidden md:flex" : "flex"}`}>
                {/* Left pane: inbox list */}
                <div className="flex flex-col w-full md:w-72 lg:w-80 shrink-0 border-r border-shrimp-border overflow-hidden">
                    {/* Header — simplified */}
                    <div className="flex flex-col border-b border-shrimp-border shrink-0">
                        <div className="flex items-center gap-2 px-3 py-2.5">
                            <span className="font-semibold text-sm flex-1">
                                {activeFolder}
                                {!searchResults && folders.find(f => f.display_name === activeFolder)?.role === "inbox" && unreadCount > 0 && (
                                    <span className="font-normal text-xs ml-2" style={{ color: 'var(--color-text-muted)' }}>
                                        {unreadCount}
                                    </span>
                                )}
                                {searchResults && (
                                    <span className="font-normal text-xs ml-2" style={{ color: 'var(--color-text-muted)' }}>
                                        {searchResults.length} result{searchResults.length !== 1 ? "s" : ""}
                                    </span>
                                )}
                            </span>
                            <button
                                onClick={() => { setComposeInitial({}); setComposing(true); }}
                                className="btn-ghost"
                                title="Compose"
                            >
                                <Pencil size={14} />
                            </button>
                            <button
                                onClick={handleFetch}
                                disabled={fetching}
                                className="btn-ghost"
                                title="Fetch new emails"
                            >
                                <RefreshCw size={14} className={fetching ? "animate-spin" : ""} />
                            </button>
                        </div>
                        {/* Folder tabs — Inbox + grouped dropdowns */}
                        {(() => {
                            const inboxFolders = folders.filter(f => f.role === "inbox");
                            const sentGroup    = folders.filter(f => f.role === "sent" || f.display_name === "Drafts");
                            const filedGroup   = folders.filter(f => f.role === "archive" || f.role === "trash" || f.role === "junk" || (f.role === "folder" && f.display_name !== "Drafts"));
                            const sentActive   = sentGroup.some(f => f.display_name === activeFolder);
                            const filedActive  = filedGroup.some(f => f.display_name === activeFolder);
                            const sentDefault  = sentGroup.find(f => f.role === "sent") ?? sentGroup[0];
                            const filedDefault = filedGroup.find(f => f.role === "trash") ?? filedGroup[0];
                            const sentLabel    = sentActive ? activeFolder : (sentDefault?.display_name ?? "Sent");
                            const filedLabel   = filedActive ? activeFolder : (filedDefault?.display_name ?? "Filed");

                            const tabStyle = (active: boolean): React.CSSProperties => ({
                                padding: "6px 12px",
                                fontSize: 12,
                                fontWeight: active ? 600 : 400,
                                color: active ? "var(--accent)" : "var(--color-text-muted)",
                                background: "transparent",
                                border: "none",
                                borderBottom: active ? "2px solid var(--accent)" : "2px solid transparent",
                                borderRadius: 0,
                                cursor: "pointer",
                                transition: "color 0.15s, border-color 0.15s",
                                whiteSpace: "nowrap",
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 3,
                            });

                            const dropdownStyle: React.CSSProperties = {
                                position: "absolute",
                                top: "100%",
                                left: 0,
                                zIndex: 50,
                                background: "var(--surface)",
                                border: "1px solid var(--color-border)",
                                borderRadius: 6,
                                minWidth: 120,
                                boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
                                overflow: "hidden",
                            };

                            const dropdownItemStyle = (active: boolean): React.CSSProperties => ({
                                display: "block",
                                width: "100%",
                                padding: "8px 14px",
                                fontSize: 12,
                                textAlign: "left",
                                background: active ? "color-mix(in srgb, var(--accent) 10%, transparent)" : "transparent",
                                color: active ? "var(--accent)" : "var(--color-text)",
                                border: "none",
                                cursor: "pointer",
                            });

                            return (
                                <div style={{ display: "flex", borderTop: "1px solid var(--color-border)" }}
                                    onClick={() => openGroup && setOpenGroup(null)}>
                                    {inboxFolders.map(f => (
                                        <button key={f.imap_name}
                                            onClick={() => { setActiveFolder(f.display_name); clearSearch(); }}
                                            style={tabStyle(activeFolder === f.display_name)}>
                                            {f.display_name}
                                        </button>
                                    ))}

                                    {sentGroup.length > 0 && sentDefault && (
                                        <div style={{ position: "relative", display: "inline-flex" }}>
                                            <button
                                                onClick={() => { setActiveFolder(sentActive ? activeFolder : sentDefault.display_name); clearSearch(); setOpenGroup(null); }}
                                                style={tabStyle(sentActive)}>
                                                {sentLabel}
                                            </button>
                                            <button
                                                onClick={e => { e.stopPropagation(); setOpenGroup(g => g === "sent" ? null : "sent"); }}
                                                style={{ ...tabStyle(sentActive), paddingLeft: 2, paddingRight: 8 }}>
                                                <ChevronDown size={10} />
                                            </button>
                                            {openGroup === "sent" && (
                                                <div style={dropdownStyle}>
                                                    {sentGroup.map(f => (
                                                        <button key={f.imap_name}
                                                            style={dropdownItemStyle(activeFolder === f.display_name)}
                                                            onClick={e => { e.stopPropagation(); setActiveFolder(f.display_name); clearSearch(); setOpenGroup(null); }}>
                                                            {f.display_name}
                                                        </button>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {filedGroup.length > 0 && filedDefault && (
                                        <div style={{ position: "relative", display: "inline-flex" }}>
                                            <button
                                                onClick={() => { setActiveFolder(filedActive ? activeFolder : filedDefault.display_name); clearSearch(); setOpenGroup(null); }}
                                                style={tabStyle(filedActive)}>
                                                {filedLabel}
                                            </button>
                                            <button
                                                onClick={e => { e.stopPropagation(); setOpenGroup(g => g === "filed" ? null : "filed"); }}
                                                style={{ ...tabStyle(filedActive), paddingLeft: 2, paddingRight: 8 }}>
                                                <ChevronDown size={10} />
                                            </button>
                                            {openGroup === "filed" && (
                                                <div style={dropdownStyle}>
                                                    {filedGroup.map(f => (
                                                        <button key={f.imap_name}
                                                            style={dropdownItemStyle(activeFolder === f.display_name)}
                                                            onClick={e => { e.stopPropagation(); setActiveFolder(f.display_name); clearSearch(); setOpenGroup(null); }}>
                                                            {f.display_name}
                                                        </button>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })()}
                        {/* Search bar */}
                        <div className="px-3 py-2 border-t border-shrimp-border flex items-center gap-1.5"
                            style={{ position: 'relative' }}>
                            <div style={{
                                display: 'flex', alignItems: 'center', flex: 1,
                                background: 'var(--color-bg-alt, rgba(255,255,255,0.05))',
                                border: '1px solid var(--border)',
                                borderRadius: 6, padding: '4px 8px', gap: 6,
                            }}>
                                <Search size={12} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
                                <input
                                    type="text"
                                    value={searchQuery}
                                    onChange={e => handleSearchChange(e.target.value)}
                                    placeholder="Search emails…"
                                    style={{
                                        flex: 1, background: 'none', border: 'none',
                                        outline: 'none', color: 'var(--color-text)',
                                        fontSize: 12, padding: 0, minWidth: 0,
                                    }}
                                />
                                {searchQuery && (
                                    <button
                                        onClick={clearSearch}
                                        className="btn-bare"
                                        style={{ color: 'var(--color-text-muted)', flexShrink: 0 }}
                                    >
                                        <X size={12} />
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Bulk action bar */}
                    {selectedIds.size > 0 && (
                        <BulkActionBar
                            count={selectedIds.size}
                            onMarkRead={() => bulkMarkRead(true)}
                            onMarkUnread={() => bulkMarkRead(false)}
                            onFlag={bulkFlag}
                            onUnflag={bulkUnflag}
                            onArchive={bulkArchive}
                            onJunk={bulkJunk}
                            onTrash={bulkTrash}
                            onClear={() => { setSelectedIds(new Set()); lastClickedIndexRef.current = -1; }}
                        />
                    )}

                    {/* List */}
                    <div className="flex-1 overflow-y-auto">
                        {(loading || searching) ? (
                            <p className="text-sm p-3" style={{ color: 'var(--color-text-muted)' }}>
                                {searching ? "Searching…" : "Loading…"}
                            </p>
                        ) : displayedEmails.length === 0 ? (
                            <div className="p-4 text-center">
                                <Mail size={28} className="mx-auto mb-2" style={{ color: 'var(--color-text-muted)' }} />
                                {searchResults !== null ? (
                                    <p className="text-sm font-medium">No results</p>
                                ) : (
                                    <>
                                        <p className="text-sm font-medium">No emails</p>
                                        <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
                                            {folders.find(f => f.display_name === activeFolder)?.role === "inbox"
                                                ? "Configure IMAP in Settings → Email."
                                                : "This folder is empty."}
                                        </p>
                                    </>
                                )}
                            </div>
                        ) : (
                            <div>
                                {displayedEmails.map((em, index) => (
                                    <EmailRow
                                        key={em.id}
                                        em={em}
                                        active={em.id === selectedId}
                                        selected={selectedIds.has(em.id)}
                                        onClick={e => handleRowClick(e, em.id, index)}
                                        onFlag={handleFlag}
                                        triageStatus={triageStatus}
                                        onContextMenu={handleContextMenu}
                                    />
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* Right pane: detail */}
                <div className="hidden md:flex flex-col flex-1 overflow-hidden">
                    {selectedEmail ? (
                        <EmailDetail
                            key={selectedEmail.id}
                            email={selectedEmail}
                            onBack={() => { setSelectedId(null); setSelectedEmail(null); }}
                            onFlag={handleFlag}
                            onCompose={initial => { setComposeInitial(initial); setComposing(true); }}
                            onMove={handleMove}
                        />
                    ) : (
                        <div className="flex flex-col items-center justify-center h-full gap-2">
                            <Mail size={36} style={{ color: 'var(--color-text-muted)' }} />
                            <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
                                Select an email to read it
                            </p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
