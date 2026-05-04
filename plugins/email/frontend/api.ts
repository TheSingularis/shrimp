/**
 * Email plugin API — all HTTP calls for the email plugin.
 * Routes live under /plugins/email/ on the backend.
 */

const BASE = import.meta.env.VITE_API_URL ?? `http://${window.location.hostname || "localhost"}:8000`;
const EMAIL = `${BASE}/plugins/email`;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface EmailMeta {
    id: string;
    message_id: string;
    from: string;
    subject: string;
    date: string;
    read: boolean;
    triaged: boolean;
    triage_priority?: string;
    triage_note?: string;
    triage_actions?: string[];
    flagged?: boolean;
    folder?: string;
}

export interface EmailAttachment {
    filename: string;
    original_filename: string;
    content_type: string;
    size: number;
}

export interface EmailFull extends EmailMeta {
    to: string;
    body: string;
    html_body?: string;
    has_genuine_plain?: boolean;
    triage_result: string | null;
    attachments?: EmailAttachment[];
}

export interface EmailConfig {
    enabled: boolean;
    imap_host: string;
    imap_port: number;
    imap_ssl: boolean;
    username: string;
    password: string;
    mailbox: string;
    fetch_max: number;
    poll_interval_minutes: number;
    auto_triage: boolean;
}

export interface SmtpConfig {
    enabled: boolean;
    smtp_host: string;
    smtp_port: number;
    smtp_ssl: boolean;
    smtp_starttls: boolean;
    username: string;
    password: string;
    from_name: string;
    from_email: string;
}

export interface EmailFolder {
    imap_name: string;
    display_name: string;
    role: "inbox" | "sent" | "trash" | "archive" | "folder";
}

export interface TriageStatus { active: boolean; processing: string | null; queued: number; queue: string[]; }

export interface DigestData {
    date: string | null;
    display_date?: string;
    generated_at?: string;
    unread_count: number;
    summary: string | null;
    action_items: string[];
}

// ── IMAP config ───────────────────────────────────────────────────────────────

export async function getEmailConfig(): Promise<EmailConfig> {
    const res = await fetch(`${EMAIL}/config`);
    if (!res.ok) throw new Error("Failed to get email config");
    return res.json();
}

export async function saveEmailConfig(cfg: Partial<EmailConfig>): Promise<void> {
    const res = await fetch(`${EMAIL}/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cfg),
    });
    if (!res.ok) throw new Error("Failed to save email config");
}

export async function testEmailConfig(): Promise<{ success: boolean; message: string }> {
    const res = await fetch(`${EMAIL}/config/test`, { method: "POST" });
    if (!res.ok) throw new Error("Failed to test email config");
    return res.json();
}

// ── SMTP config ───────────────────────────────────────────────────────────────

export async function getSmtpConfig(): Promise<SmtpConfig> {
    const res = await fetch(`${EMAIL}/smtp/config`);
    if (!res.ok) throw new Error("Failed to get SMTP config");
    return res.json();
}

export async function saveSmtpConfig(cfg: Partial<SmtpConfig>): Promise<void> {
    const res = await fetch(`${EMAIL}/smtp/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cfg),
    });
    if (!res.ok) throw new Error("Failed to save SMTP config");
}

export async function testSmtpConfig(): Promise<{ success: boolean; message: string }> {
    const res = await fetch(`${EMAIL}/smtp/config/test`, { method: "POST" });
    if (!res.ok) throw new Error("Failed to test SMTP config");
    return res.json();
}

// ── Send ──────────────────────────────────────────────────────────────────────

export async function sendEmail(params: {
    to: string; subject: string; body: string; cc?: string; bcc?: string;
}): Promise<void> {
    const res = await fetch(`${EMAIL}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Send failed" }));
        throw new Error((err as { detail?: string }).detail || "Send failed");
    }
}

// ── Inbox / folders ───────────────────────────────────────────────────────────

export async function getInbox(limit = 50, folder = "INBOX"): Promise<EmailMeta[]> {
    const res = await fetch(`${EMAIL}/inbox?limit=${limit}&folder=${encodeURIComponent(folder)}`);
    if (!res.ok) throw new Error("Failed to get inbox");
    return res.json();
}

export async function searchEmails(q: string, limit = 50): Promise<EmailMeta[]> {
    const res = await fetch(`${EMAIL}/search?q=${encodeURIComponent(q)}&limit=${limit}`);
    if (!res.ok) throw new Error("Failed to search emails");
    return res.json();
}

export async function fetchInbox(): Promise<{ fetched: number }> {
    const res = await fetch(`${EMAIL}/fetch`, { method: "POST" });
    if (!res.ok) throw new Error("Failed to fetch inbox");
    return res.json();
}

export async function fetchFolder(folder: string, limit = 50): Promise<{ fetched: number }> {
    const res = await fetch(`${EMAIL}/fetch/${encodeURIComponent(folder)}?limit=${limit}`, { method: "POST" });
    if (!res.ok) throw new Error(`Failed to fetch ${folder}`);
    return res.json();
}

export async function getFolders(): Promise<EmailFolder[]> {
    const res = await fetch(`${EMAIL}/folders`);
    if (!res.ok) throw new Error("Failed to get folders");
    return res.json();
}

// ── Individual email ──────────────────────────────────────────────────────────

export async function getEmail(id: string): Promise<EmailFull> {
    const res = await fetch(`${EMAIL}/${id}`);
    if (!res.ok) throw new Error("Failed to get email");
    return res.json();
}

export function attachmentUrl(emailId: string, filename: string, download = false): string {
    const dl = download ? "?dl=1" : "";
    return `${EMAIL}/${emailId}/attachment/${encodeURIComponent(filename)}${dl}`;
}

export async function refreshEmailBody(id: string): Promise<EmailFull> {
    const res = await fetch(`${EMAIL}/${id}/refresh-body`, { method: "POST" });
    if (!res.ok) throw new Error("Failed to refresh email body");
    return res.json();
}

export async function refreshAllEmailBodies(): Promise<{ refreshed: number }> {
    const res = await fetch(`${EMAIL}/refresh-all`, { method: "POST" });
    if (!res.ok) throw new Error("Failed to refresh emails");
    return res.json();
}

export async function getFlaggedEmails(): Promise<EmailMeta[]> {
    const res = await fetch(`${EMAIL}/flagged`);
    if (!res.ok) throw new Error("Failed to get flagged emails");
    return res.json();
}

export async function setEmailFlag(id: string, flagged: boolean): Promise<void> {
    const res = await fetch(`${EMAIL}/${id}/flag`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flagged }),
    });
    if (!res.ok) throw new Error("Failed to update flag");
}

export async function setEmailRead(id: string, read: boolean): Promise<void> {
    const res = await fetch(`${EMAIL}/${id}/read`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ read }),
    });
    if (!res.ok) throw new Error("Failed to update read status");
}

export async function moveEmail(id: string, destFolder: string): Promise<void> {
    const res = await fetch(`${EMAIL}/${id}/move`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dest_folder: destFolder }),
    });
    if (!res.ok) throw new Error("Failed to move email");
}

export async function archiveEmail(id: string): Promise<void> {
    const res = await fetch(`${EMAIL}/${id}/archive`, { method: "POST" });
    if (!res.ok) throw new Error("Failed to archive email");
}

export async function trashEmail(id: string): Promise<void> {
    const res = await fetch(`${EMAIL}/${id}/trash`, { method: "POST" });
    if (!res.ok) throw new Error("Failed to trash email");
}

export async function junkEmail(id: string): Promise<void> {
    const res = await fetch(`${EMAIL}/${id}/junk`, { method: "POST" });
    if (!res.ok) throw new Error("Failed to mark email as junk");
}

// ── Triage ────────────────────────────────────────────────────────────────────

export async function getTriageStatus(): Promise<TriageStatus> {
    const res = await fetch(`${EMAIL}/triage/status`);
    if (!res.ok) throw new Error("Failed to get triage status");
    return res.json();
}

export async function triageEmail(id: string, signal?: AbortSignal): Promise<EmailFull> {
    const res = await fetch(`${EMAIL}/${id}/triage`, { method: "POST", signal });
    if (!res.ok) {
        const detail = await res.json().catch(() => ({})) as { detail?: string };
        throw new Error(detail.detail || "Failed to triage email");
    }
    return res.json() as Promise<EmailFull>;
}

// ── Digest ────────────────────────────────────────────────────────────────────

export async function getDigest(): Promise<DigestData> {
    const res = await fetch(`${EMAIL}/digest/latest`);
    if (!res.ok) throw new Error("Failed to get digest");
    return res.json();
}
