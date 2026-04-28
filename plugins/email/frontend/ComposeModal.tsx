import { useState, useEffect, useRef } from "react";
import { X, Send, ChevronDown, ChevronUp } from "lucide-react";
import { sendEmail } from "./api";

interface Props {
    onClose: () => void;
    /** Pre-fill fields when replying or forwarding */
    initial?: {
        to?: string;
        subject?: string;
        body?: string;
        cc?: string;
    };
}

export function ComposeModal({ onClose, initial = {} }: Props) {
    const [to, setTo] = useState(initial.to ?? "");
    const [cc, setCc] = useState(initial.cc ?? "");
    const [subject, setSubject] = useState(initial.subject ?? "");
    const [body, setBody] = useState(initial.body ?? "");
    const [showCc, setShowCc] = useState(!!initial.cc);
    const [sending, setSending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [sent, setSent] = useState(false);
    const toRef = useRef<HTMLInputElement>(null);

    // Electron ignores autoFocus inside non-top-level components — force it
    useEffect(() => {
        const t = setTimeout(() => toRef.current?.focus(), 50);
        return () => clearTimeout(t);
    }, []);

    async function handleSend() {
        if (!to.trim() || !subject.trim()) return;
        setSending(true);
        setError(null);
        try {
            await sendEmail({ to: to.trim(), subject: subject.trim(), body, cc: cc.trim() });
            setSent(true);
            setTimeout(onClose, 1200);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Send failed");
        } finally {
            setSending(false);
        }
    }

    return (
        <>
            {/* Backdrop */}
            <div
                onClick={onClose}
                style={{
                    position: "fixed", inset: 0, zIndex: 1000,
                    background: "rgba(0,0,0,0.5)",
                }}
            />

            {/* Modal */}
            <div style={{
                position: "fixed", zIndex: 1001,
                top: "50%", left: "50%", transform: "translate(-50%, -50%)",
                width: "min(680px, 95vw)",
                background: "var(--color-bg-dark)",
                border: "1px solid var(--border)",
                borderRadius: 10,
                display: "flex", flexDirection: "column",
                maxHeight: "85vh",
                boxShadow: "0 24px 64px rgba(0,0,0,0.5)",
            }}>
                {/* Header */}
                <div style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    padding: "12px 16px",
                    borderBottom: "1px solid var(--border)",
                    flexShrink: 0,
                }}>
                    <span style={{ fontSize: 14, fontWeight: 600 }}>New Message</span>
                    <button className="close-btn" onClick={onClose}>
                        <X size={18} />
                    </button>
                </div>

                {/* Fields */}
                <div style={{ display: "flex", flexDirection: "column", flexShrink: 0, borderBottom: "1px solid var(--border)" }}>
                    {/* To */}
                    <div style={{ display: "flex", alignItems: "center", borderBottom: "1px solid var(--border)", padding: "0 16px" }}>
                        <span style={{ fontSize: 12, color: "var(--color-text-muted)", width: 48, flexShrink: 0 }}>To</span>
                        <input
                            ref={toRef}
                            type="email"
                            value={to}
                            onChange={e => setTo(e.target.value)}
                            placeholder="recipient@example.com"
                            style={{
                                flex: 1, background: "none", border: "none", outline: "none",
                                padding: "10px 0", fontSize: 13, color: "var(--color-text)",
                            }}
                        />
                        <button
                            className="btn-bare"
                            onClick={() => setShowCc(v => !v)}
                            style={{ color: "var(--color-text-muted)", fontSize: 11, gap: 2, display: "flex", alignItems: "center" }}
                        >
                            Cc {showCc ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                        </button>
                    </div>

                    {/* Cc (optional) */}
                    {showCc && (
                        <div style={{ display: "flex", alignItems: "center", borderBottom: "1px solid var(--border)", padding: "0 16px" }}>
                            <span style={{ fontSize: 12, color: "var(--color-text-muted)", width: 48, flexShrink: 0 }}>Cc</span>
                            <input
                                type="email"
                                value={cc}
                                onChange={e => setCc(e.target.value)}
                                placeholder="cc@example.com"
                                style={{
                                    flex: 1, background: "none", border: "none", outline: "none",
                                    padding: "10px 0", fontSize: 13, color: "var(--color-text)",
                                }}
                            />
                        </div>
                    )}

                    {/* Subject */}
                    <div style={{ display: "flex", alignItems: "center", padding: "0 16px" }}>
                        <span style={{ fontSize: 12, color: "var(--color-text-muted)", width: 48, flexShrink: 0 }}>Subject</span>
                        <input
                            type="text"
                            value={subject}
                            onChange={e => setSubject(e.target.value)}
                            placeholder="Subject"
                            style={{
                                flex: 1, background: "none", border: "none", outline: "none",
                                padding: "10px 0", fontSize: 13, color: "var(--color-text)",
                            }}
                        />
                    </div>
                </div>

                {/* Body */}
                <textarea
                    value={body}
                    onChange={e => setBody(e.target.value)}
                    placeholder="Write your message…"
                    style={{
                        flex: 1, resize: "none", background: "none", border: "none", outline: "none",
                        padding: "14px 16px", fontSize: 13, color: "var(--color-text)",
                        fontFamily: "inherit", lineHeight: 1.6, minHeight: 220,
                    }}
                />

                {/* Footer */}
                <div style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    padding: "10px 16px",
                    borderTop: "1px solid var(--border)",
                    flexShrink: 0,
                }}>
                    <div style={{ fontSize: 12, color: sent ? "var(--accent)" : "var(--color-error, #ef4444)" }}>
                        {sent ? "✓ Sent!" : error ?? ""}
                    </div>
                    <button
                        onClick={handleSend}
                        disabled={sending || !to.trim() || !subject.trim() || sent}
                        className="btn-primary"
                    >
                        <Send size={13} />
                        {sending ? "Sending…" : "Send"}
                    </button>
                </div>
            </div>
        </>
    );
}
