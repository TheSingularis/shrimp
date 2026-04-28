import { useState, useRef, useEffect, useMemo } from "react";
import { ArrowLeft, Sparkles, X, FileText, Globe, Copy, Star, RefreshCw, Reply, Forward, Archive, Trash2, ShieldAlert, Paperclip, Download, Eye } from "lucide-react";
import DOMPurify from "dompurify";
import { triageEmail, setEmailFlag, refreshEmailBody, archiveEmail, trashEmail, junkEmail, attachmentUrl, type EmailFull, type EmailAttachment } from "../api";
import { formatDateFull } from "../utils/email";
import { URGENCY_CONFIG, type UrgencyLevel } from "../utils/urgency";

interface ComposeInitial { to?: string; subject?: string; body?: string; cc?: string; }

interface Props {
    email: EmailFull;
    onBack: () => void;
    onFlag?: (id: string, flagged: boolean) => void;
    onCompose?: (initial: ComposeInitial) => void;
    onMove?: (id: string, folder: string) => void;
}

// ── Triage parser ─────────────────────────────────────────────────────────────

interface TriageParsed {
    urgency: string;
    summary: string;
    actions: string[];
    reply: string;
}

function parseTriage(raw: string): TriageParsed {
    const result: TriageParsed = { urgency: "", summary: "", actions: [], reply: "" };
    let section = "";
    const replyLines: string[] = [];

    for (const line of raw.split("\n")) {
        const t = line.trim();
        if (!t) {
            if (section === "reply") replyLines.push("");
            continue;
        }

        if (/\*\*urgency\*\*/i.test(t)) {
            section = "urgency";
            const m = t.match(/\*\*urgency\*\*[:\s]+(.+)/i);
            if (m) result.urgency = m[1].replace(/\*\*/g, "").trim().toLowerCase();
        } else if (/\*\*summary\*\*/i.test(t)) {
            section = "summary";
            const m = t.match(/\*\*summary\*\*[:\s]+(.+)/i);
            if (m) result.summary = m[1].replace(/\*\*/g, "").trim();
        } else if (/\*\*action items?\*\*/i.test(t)) {
            section = "actions";
        } else if (/\*\*suggested reply\*\*/i.test(t)) {
            section = "reply";
            const m = t.match(/\*\*suggested reply\*\*[:\s]*(.+)?/i);
            if (m?.[1]) replyLines.push(m[1].replace(/^["']|["']$/g, "").trim());
        } else {
            if (section === "actions" && /^[-*•]/.test(t)) {
                result.actions.push(t.replace(/^[-*•]\s*/, "").trim());
            } else if (section === "summary" && !result.summary) {
                result.summary = t;
            } else if (section === "reply") {
                replyLines.push(t.replace(/^["']|["']$/g, "").trim());
            }
        }
    }
    result.reply = replyLines.join("\n").trim();
    return result;
}


function TriagePanel({ raw, streaming, hideSuggestedReply }: { raw: string; streaming: boolean; hideSuggestedReply?: boolean }) {
    const parsed = parseTriage(raw);
    const hasContent = parsed.urgency || parsed.summary || parsed.actions.length > 0;
    const urgencyStyle = URGENCY_CONFIG[parsed.urgency as UrgencyLevel] ?? URGENCY_CONFIG.normal;
    const [copied, setCopied] = useState(false);

    function copyReply() {
        navigator.clipboard.writeText(parsed.reply);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    }

    // While streaming, show raw text; once done, show formatted view
    if (streaming || !hasContent) {
        return (
            <pre className="text-xs whitespace-pre-wrap font-sans leading-relaxed">
                {raw}
                {streaming && <span className="animate-pulse">▋</span>}
            </pre>
        );
    }

    return (
        <div className="flex flex-col gap-3">
            {/* Urgency badge */}
            {parsed.urgency && (
                <div className="flex items-center gap-2">
                    <span
                        className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-semibold"
                        style={{ color: urgencyStyle.color, background: urgencyStyle.bg }}
                    >
                        {urgencyStyle.icon}
                        {urgencyStyle.label}
                    </span>
                </div>
            )}

            {/* Summary */}
            {parsed.summary && (
                <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider mb-1"
                        style={{ color: 'var(--color-text-muted)' }}>Summary</p>
                    <p className="text-sm leading-relaxed">{parsed.summary}</p>
                </div>
            )}

            {/* Action items */}
            {parsed.actions.length > 0 && (
                <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider mb-1.5"
                        style={{ color: 'var(--color-text-muted)' }}>Action Items</p>
                    <ul className="flex flex-col gap-1.5">
                        {parsed.actions.map((a, i) => (
                            <li key={i} className="flex items-start gap-2 text-sm">
                                <span className="shrink-0 mt-1 w-1.5 h-1.5 rounded-full"
                                    style={{ background: 'var(--theme-primary)' }} />
                                {a}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {/* Suggested reply */}
            {!hideSuggestedReply && parsed.reply && (
                <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider mb-1.5"
                        style={{ color: 'var(--color-text-muted)' }}>Suggested Reply</p>
                    <div className="relative rounded-lg p-3 pr-8 text-sm leading-relaxed italic overflow-y-auto whitespace-pre-wrap"
                        style={{
                            background: 'color-mix(in srgb, var(--theme-primary) 6%, transparent)',
                            borderLeft: '2px solid var(--theme-primary)',
                            borderRadius: '0 6px 6px 0',
                            maxHeight: '120px',
                        }}>
                        {parsed.reply}
                        <button
                            onClick={copyReply}
                            title="Copy reply"
                            className="btn-ghost absolute top-2 right-2"
                            style={{ color: copied ? 'var(--theme-primary)' : undefined }}
                        >
                            <Copy size={11} />
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

// ── Plain text renderer ───────────────────────────────────────────────────────

function decodeEntities(text: string): string {
    const ta = document.createElement("textarea");
    ta.innerHTML = text;
    return ta.value;
}

function cleanPlainText(text: string): string {
    return decodeEntities(text)
        .replace(/[\u200b\u200c\u200d\ufeff\u00ad\u2028\u2029]/g, "")
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n")
        .trimEnd();
}

const URL_RE = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/g;
const MAIL_RE = /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g;

function linkifyLine(line: string, key: number): React.ReactNode {
    const segments: React.ReactNode[] = [];
    // Combine URL and email patterns, process left-to-right
    const combined = new RegExp(`${URL_RE.source}|${MAIL_RE.source}`, "g");
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = combined.exec(line)) !== null) {
        if (m.index > last) segments.push(line.slice(last, m.index));
        const href = m[0].startsWith("http") ? m[0] : `mailto:${m[0]}`;
        // Display truncated URL (max 60 chars) for readability
        const display = m[0].length > 60 ? m[0].slice(0, 57) + "…" : m[0];
        segments.push(
            <a key={m.index} href={href} target="_blank" rel="noopener noreferrer"
               title={m[0]}
               style={{ color: '#4f86c6', wordBreak: 'break-all', textDecoration: 'underline' }}>
                {display}
            </a>
        );
        last = m.index + m[0].length;
    }
    if (last < line.length) segments.push(line.slice(last));
    return <span key={key}>{segments}</span>;
}

function PlainTextBody({ text }: { text: string }) {
    const cleaned = cleanPlainText(text);
    const lines = cleaned.split("\n");

    const nodes: React.ReactNode[] = [];
    let quoteBuffer: string[] = [];
    let quoteDepth = 0;

    function flushQuotes() {
        if (quoteBuffer.length === 0) return;
        nodes.push(
            <blockquote key={`q${nodes.length}`} style={{
                borderLeft: "3px solid rgba(128,128,128,0.35)",
                paddingLeft: "10px",
                margin: "4px 0",
                color: "var(--color-text-muted)",
                opacity: 0.75,
            }}>
                {quoteBuffer.map((l, i) => (
                    <span key={i}>{linkifyLine(l.replace(/^>+\s?/, ""), i)}{"\n"}</span>
                ))}
            </blockquote>
        );
        quoteBuffer = [];
        quoteDepth = 0;
    }

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const depth = (line.match(/^>+/) ?? [""])[0].length;
        if (depth > 0) {
            if (quoteBuffer.length === 0 || depth === quoteDepth) {
                quoteBuffer.push(line);
                quoteDepth = depth;
            } else {
                flushQuotes();
                quoteBuffer.push(line);
                quoteDepth = depth;
            }
        } else {
            flushQuotes();
            nodes.push(<span key={i}>{linkifyLine(line, i)}{"\n"}</span>);
        }
    }
    flushQuotes();

    return (
        <div className="h-full overflow-y-auto px-5 py-4">
            <pre className="text-sm font-sans leading-relaxed" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                {nodes}
            </pre>
        </div>
    );
}

// ── HTML email renderer (sandboxed iframe) ────────────────────────────────────

function looksLikeHtml(text: string): boolean {
    const sample = text.slice(0, 2000).toLowerCase().trimStart();
    if (sample.startsWith("<!doctype html") || /^<html[\s>]/.test(sample)) return true;
    const tags = ["<body", "<div>", "<div ", "<p>", "<p ", "<table", "<td", "<tr",
                  "<span>", "<span ", "<br>", "<br/", "<a ", "<img "];
    return tags.filter(t => sample.includes(t)).length >= 2;
}

function isRichHtml(html: string): boolean {
    const imgCount = (html.match(/<img\b/gi) ?? []).length;
    const tableCount = (html.match(/<table\b/gi) ?? []).length;
    return imgCount > 2 || tableCount >= 3;
}

function preferredView(e: Pick<EmailFull, "body" | "html_body">): "html" | "plain" {
    const bodyIsHtml = looksLikeHtml(e.body || "");
    const hasPlainBody = !!(e.body && !bodyIsHtml);
    if (!hasPlainBody) return (e.html_body || bodyIsHtml) ? "html" : "plain";
    if (e.html_body && isRichHtml(e.html_body)) return "html";
    return "plain";
}

// Base CSS injected into every HTML email iframe — resets defaults and constrains width.
const EMAIL_IFRAME_CSS = `
  html, body {
    margin: 0; padding: 16px 20px;
    background: #ffffff; color: #1a1a1a;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    font-size: 14px; line-height: 1.6;
    word-wrap: break-word; overflow-wrap: break-word;
  }
  img { max-width: 100% !important; height: auto !important; }
  a { color: #0066cc; }
  table { border-collapse: collapse; max-width: 100% !important; }
  td, th { word-break: break-word; vertical-align: top; }
  pre, code { white-space: pre-wrap; font-size: 13px; word-break: break-all; }
  blockquote { border-left: 3px solid #ccc; margin: 8px 0; padding: 4px 0 4px 12px; color: #555; }
  p { margin: 6px 0; }
  center { width: 100% !important; }
`;

function HtmlEmailBody({ html }: { html: string }) {
    const iframeRef = useRef<HTMLIFrameElement>(null);

    // Sanitize + wrap in a full HTML document so the email renders in its own context.
    // allow-same-origin lets us read scrollHeight and patch links after load.
    // Scripts are blocked (no allow-scripts) — sandbox is the real security layer.
    const srcdoc = useMemo(() => {
        const clean = DOMPurify.sanitize(html, {
            FORBID_TAGS: ["script", "noscript", "object", "embed", "form"],
            ADD_ATTR: ["bgcolor", "border", "cellpadding", "cellspacing", "height",
                       "target", "rel", "style"],
        });
        return `<!DOCTYPE html><html><head><meta charset="utf-8">` +
               `<meta name="viewport" content="width=device-width,initial-scale=1">` +
               `<style>${EMAIL_IFRAME_CSS}</style></head><body>${clean}</body></html>`;
    }, [html]);

    function resize() {
        const iframe = iframeRef.current;
        if (!iframe?.contentDocument?.documentElement) return;
        const h = iframe.contentDocument.documentElement.scrollHeight;
        if (h > 0) iframe.style.height = `${h}px`;
    }

    function handleLoad() {
        const doc = iframeRef.current?.contentDocument;
        if (!doc) return;
        // Patch links to open in new tab
        doc.querySelectorAll<HTMLAnchorElement>("a[href]").forEach(a => {
            if (!a.href.startsWith("mailto:")) {
                a.target = "_blank";
                a.rel = "noopener noreferrer";
            }
        });
        resize();
        // Re-resize once images load (they shift content height)
        doc.querySelectorAll<HTMLImageElement>("img").forEach(img => {
            if (!img.complete) img.addEventListener("load", resize, { once: true });
        });
    }

    return (
        <div className="h-full overflow-y-auto">
            <iframe
                ref={iframeRef}
                srcDoc={srcdoc}
                sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
                onLoad={handleLoad}
                title="Email content"
                style={{ width: "100%", height: "500px", border: "none", display: "block" }}
            />
        </div>
    );
}

// ── Attachment bar ─────────────────────────────────────────────────────────────

function formatBytes(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1_048_576) return `${(n / 1024).toFixed(0)} KB`;
    return `${(n / 1_048_576).toFixed(1)} MB`;
}

function isImage(ct: string) { return ct.startsWith("image/"); }
function isPdf(ct: string) { return ct === "application/pdf"; }
function isPreviewable(ct: string) { return isImage(ct) || isPdf(ct); }

function AttachmentBar({ emailId, attachments }: { emailId: string; attachments: EmailAttachment[] }) {
    const [preview, setPreview] = useState<EmailAttachment | null>(null);

    if (!attachments.length) return null;

    return (
        <>
            <div style={{
                borderTop: "1px solid var(--color-border)",
                padding: "8px 16px",
                display: "flex",
                flexWrap: "wrap",
                gap: 6,
                alignItems: "center",
            }}>
                <Paperclip size={13} style={{ color: "var(--color-text-muted)", flexShrink: 0 }} />
                {attachments.map(a => (
                    <div key={a.filename} style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        background: "var(--color-bg-elevated)",
                        border: "1px solid var(--color-border)",
                        borderRadius: 6,
                        padding: "3px 8px",
                        fontSize: 11,
                    }}>
                        <span style={{ color: "var(--color-text)", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {a.original_filename || a.filename}
                        </span>
                        <span style={{ color: "var(--color-text-muted)", flexShrink: 0 }}>{formatBytes(a.size)}</span>
                        {isPreviewable(a.content_type) && (
                            <button className="btn-bare" title="Preview"
                                style={{ color: "var(--color-text-muted)", flexShrink: 0 }}
                                onClick={() => setPreview(a)}>
                                <Eye size={12} />
                            </button>
                        )}
                        <a href={attachmentUrl(emailId, a.filename, true)}
                            download={a.original_filename || a.filename}
                            title="Download"
                            style={{ color: "var(--color-text-muted)", display: "flex", alignItems: "center", flexShrink: 0 }}>
                            <Download size={12} />
                        </a>
                    </div>
                ))}
            </div>

            {/* Preview overlay */}
            {preview && (
                <div
                    onClick={() => setPreview(null)}
                    style={{
                        position: "fixed", inset: 0, zIndex: 200,
                        background: "rgba(0,0,0,0.75)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                    <div onClick={e => e.stopPropagation()} style={{ position: "relative", maxWidth: "90vw", maxHeight: "90vh" }}>
                        <button className="btn-ghost" onClick={() => setPreview(null)}
                            style={{ position: "absolute", top: -36, right: 0, color: "#fff" }}>
                            <X size={20} />
                        </button>
                        {isImage(preview.content_type) ? (
                            <img
                                src={attachmentUrl(emailId, preview.filename)}
                                alt={preview.original_filename || preview.filename}
                                style={{ maxWidth: "90vw", maxHeight: "90vh", borderRadius: 8 }}
                            />
                        ) : (
                            <iframe
                                src={attachmentUrl(emailId, preview.filename)}
                                title={preview.original_filename || preview.filename}
                                style={{ width: "80vw", height: "80vh", border: "none", borderRadius: 8, background: "#fff" }}
                            />
                        )}
                    </div>
                </div>
            )}
        </>
    );
}


// ── Main component ────────────────────────────────────────────────────────────

export function EmailDetail({ email: initialEmail, onBack, onFlag, onCompose, onMove }: Props) {
    const [email, setEmail] = useState(initialEmail);
    // Use html_body if available; fall back to body if it looks like HTML
    const htmlSource = email.html_body || (looksLikeHtml(email.body || "") ? email.body : null);
    const hasHtml = !!htmlSource;
    const [viewMode, setViewMode] = useState<"html" | "plain">(() => preferredView(email));
    const [triageText, setTriageText] = useState(email.triage_result || "");
    const [triaging, setTriaging] = useState(false);
    const [flagged, setFlagged] = useState(email.flagged ?? false);
    const [refreshing, setRefreshing] = useState(false);
    const abortRef = useRef<AbortController | null>(null);

    // Sync when parent passes a new email object
    useEffect(() => {
        setEmail(initialEmail);
    }, [initialEmail]);

    // Reset state when a different email is opened
    useEffect(() => {
        abortRef.current?.abort();
        setTriaging(false);
        setTriageText(email.triage_result || "");
        setViewMode(preferredView(email));
        setFlagged(email.flagged ?? false);

        // Auto-fetch HTML body in background if missing
        const src = email.html_body || (looksLikeHtml(email.body || "") ? email.body : null);
        if (!src) {
            refreshEmailBody(email.id)
                .then(updated => {
                    setEmail(updated);
                    // Only switch to HTML if there's still no plain text alternative
                    if (preferredView(updated) === "html") setViewMode("html");
                })
                .catch(() => {});
        }
    }, [email.id]);

    async function handleRefreshBody() {
        setRefreshing(true);
        try {
            const updated = await refreshEmailBody(email.id);
            setEmail(updated);
            if (preferredView(updated) === "html") setViewMode("html");
        } catch {
            // silently ignore — IMAP may not be configured
        } finally {
            setRefreshing(false);
        }
    }

    async function handleFlag() {
        const next = !flagged;
        setFlagged(next);
        onFlag?.(email.id, next);
        try {
            await setEmailFlag(email.id, next);
        } catch {
            setFlagged(!next); // revert
        }
    }

    async function handleArchive() {
        try {
            await archiveEmail(email.id);
            onMove?.(email.id, "Archive");
            onBack();
        } catch (e) {
            console.error("Archive failed:", e);
        }
    }

    async function handleTrash() {
        try {
            await trashEmail(email.id);
            onMove?.(email.id, "Trash");
            onBack();
        } catch (e) {
            console.error("Trash failed:", e);
        }
    }

    async function handleJunk() {
        try {
            await junkEmail(email.id);
            onMove?.(email.id, "Junk");
            onBack();
        } catch (e) {
            console.error("Junk failed:", e);
        }
    }

    async function handleTriage() {
        if (triaging) {
            abortRef.current?.abort();
            setTriaging(false);
            return;
        }
        setTriageText("");
        setTriaging(true);
        abortRef.current = new AbortController();
        try {
            await triageEmail(email.id, (token) => setTriageText(t => t + token), abortRef.current.signal);
        } catch (e: unknown) {
            if (e instanceof Error && e.name !== "AbortError") {
                setTriageText(t => t + `\n\nError: ${e.message}`);
            }
        } finally {
            setTriaging(false);
        }
    }

    function buildQuote(): string {
        const plain = email.body?.trim() || "";
        const header = `On ${formatDateFull(email.date)}, ${email.from} wrote:`;
        return `\n\n---\n${header}\n\n${plain.split("\n").map(l => `> ${l}`).join("\n")}`;
    }

    function handleReply() {
        const subj = email.subject?.startsWith("Re:") ? email.subject : `Re: ${email.subject}`;
        onCompose?.({ to: email.from, subject: subj, body: buildQuote() });
    }

    function handleForward() {
        const subj = email.subject?.startsWith("Fwd:") ? email.subject : `Fwd: ${email.subject}`;
        onCompose?.({ subject: subj, body: buildQuote() });
    }

    return (
        <div className="flex flex-col h-full overflow-hidden">
            {/* Header */}
            <div className="shrink-0 flex items-center gap-3 px-4 py-3 border-b border-shrimp-border">
                <button onClick={onBack} className="btn-ghost">
                    <ArrowLeft size={16} />
                </button>

                <div className="flex-1 min-w-0">
                    <h2 className="font-semibold text-sm truncate">{email.subject}</h2>
                    <p className="text-xs truncate" style={{ color: 'var(--color-text-muted)' }}>
                        {email.from} · {formatDateFull(email.date)}
                    </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                    {/* Refresh body button — always visible so re-fetch picks up fixes (e.g. cid: images) */}
                    <button onClick={handleRefreshBody} disabled={refreshing} title="Re-fetch email body" className="btn-ghost">
                        <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} />
                    </button>

                    {/* HTML / Plain toggle — only shown when HTML is available */}
                    {hasHtml && (
                        <div className="flex items-center rounded-lg overflow-hidden border border-shrimp-border">
                            <button
                                onClick={() => setViewMode("html")}
                                className={`btn-secondary${viewMode === "html" ? " active" : ""}`}
                                style={{ borderRadius: 0, border: 'none' }}
                            >
                                <Globe size={11} /> HTML
                            </button>
                            <button
                                onClick={() => setViewMode("plain")}
                                className={`btn-secondary${viewMode === "plain" ? " active" : ""}`}
                                style={{ borderRadius: 0, border: 'none', borderLeft: '1px solid var(--color-border)' }}
                            >
                                <FileText size={11} /> Plain
                            </button>
                        </div>
                    )}

                    <button onClick={handleArchive} title="Archive" className="btn-secondary">
                        <Archive size={12} /> Archive
                    </button>
                    <button onClick={handleJunk} title="Mark as junk" className="btn-secondary danger">
                        <ShieldAlert size={12} /> Junk
                    </button>
                    <button onClick={handleTrash} title="Move to trash" className="btn-secondary danger">
                        <Trash2 size={12} /> Trash
                    </button>

                    <button onClick={handleReply} title="Reply" className="btn-secondary">
                        <Reply size={12} /> Reply
                    </button>
                    <button onClick={handleForward} title="Forward" className="btn-secondary">
                        <Forward size={12} /> Fwd
                    </button>

                    <button
                        onClick={handleTriage}
                        className={`btn-secondary${triaging ? " danger" : ""}`}
                        style={!triaging ? { color: 'var(--accent)', borderColor: 'color-mix(in srgb, var(--accent) 50%, var(--border))' } : undefined}
                    >
                        {triaging ? <X size={12} /> : <Sparkles size={12} />}
                        {triaging ? "Stop" : "Triage with AI"}
                    </button>

                    <button
                        onClick={handleFlag}
                        title={flagged ? "Unflag" : "Flag"}
                        className={`btn-ghost${flagged ? " flagged" : ""}`}
                    >
                        <Star size={14} fill={flagged ? "#f59e0b" : "none"} />
                    </button>
                </div>
            </div>

            {/* Triage panel */}
            {(triageText || triaging) && (
                <div
                    className="shrink-0 border-b border-shrimp-border px-4 py-4 overflow-y-auto"
                    style={{ maxHeight: "340px", background: 'color-mix(in srgb, var(--theme-primary) 4%, transparent)' }}
                >
                    <TriagePanel
                        raw={triageText}
                        streaming={triaging}
                        hideSuggestedReply={/sent|draft/i.test(email.folder ?? "")}
                    />
                </div>
            )}

            {/* Body */}
            <div className="flex-1 overflow-hidden">
                {viewMode === "html" && htmlSource ? (
                    <HtmlEmailBody html={htmlSource} />
                ) : (
                    <PlainTextBody text={email.body || ""} />
                )}
            </div>

            {/* Attachments */}
            {email.attachments && email.attachments.length > 0 && (
                <AttachmentBar emailId={email.id} attachments={email.attachments} />
            )}
        </div>
    );
}
