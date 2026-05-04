import { useState, useEffect } from "react";
import {
    getEmailConfig, saveEmailConfig, testEmailConfig, type EmailConfig,
    getSmtpConfig, saveSmtpConfig, testSmtpConfig, type SmtpConfig,
} from "./api";

export function EmailSettingsSection() {
    const [emailConfig, setEmailConfig] = useState<EmailConfig>({
        enabled: false, imap_host: "", imap_port: 993, imap_ssl: true,
        username: "", password: "", mailbox: "INBOX", fetch_max: 50, poll_interval_minutes: 15,
        auto_triage: true,
    });
    const [emailSaving, setEmailSaving] = useState(false);
    const [emailTesting, setEmailTesting] = useState(false);
    const [emailTestResult, setEmailTestResult] = useState<{ success: boolean; message: string } | null>(null);

    const [smtpConfig, setSmtpConfig] = useState<SmtpConfig>({
        enabled: false, smtp_host: "", smtp_port: 587, smtp_ssl: false, smtp_starttls: true,
        username: "", password: "", from_name: "", from_email: "",
    });
    const [smtpSaving, setSmtpSaving] = useState(false);
    const [smtpTesting, setSmtpTesting] = useState(false);
    const [smtpTestResult, setSmtpTestResult] = useState<{ success: boolean; message: string } | null>(null);

    useEffect(() => {
        getEmailConfig().then(setEmailConfig).catch(() => {});
        getSmtpConfig().then(setSmtpConfig).catch(() => {});
    }, []);

    return (
        <>
            <section className="drawer-section">
                <h2>IMAP CONFIGURATION</h2>
                <p style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginBottom: "0.75rem" }}>
                    Credentials are stored locally in config.py and never leave your machine.
                </p>

                <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
                    <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.85rem" }}>
                        <input
                            type="checkbox"
                            checked={emailConfig.enabled}
                            onChange={e => setEmailConfig(c => ({ ...c, enabled: e.target.checked }))}
                        />
                        Enable email integration
                    </label>

                    {[
                        { label: "IMAP Host", key: "imap_host", type: "text", placeholder: "imap.gmail.com" },
                        { label: "Port", key: "imap_port", type: "number", placeholder: "993" },
                        { label: "Username / Email", key: "username", type: "email", placeholder: "you@example.com" },
                        { label: "Password / App password", key: "password", type: "password", placeholder: "••••••••" },
                        { label: "Mailbox", key: "mailbox", type: "text", placeholder: "INBOX" },
                        { label: "Max emails per fetch", key: "fetch_max", type: "number", placeholder: "50" },
                        { label: "Poll interval (minutes)", key: "poll_interval_minutes", type: "number", placeholder: "15" },
                    ].map(({ label, key, type, placeholder }) => (
                        <div key={key}>
                            <label style={{ fontSize: "0.75rem", color: "var(--text-muted)", display: "block", marginBottom: "0.2rem" }}>
                                {label}
                            </label>
                            <input
                                type={type}
                                value={String((emailConfig as Record<string, unknown>)[key] ?? "")}
                                onChange={e => setEmailConfig(c => ({ ...c, [key]: type === "number" ? parseInt(e.target.value) || 0 : e.target.value }))}
                                placeholder={placeholder}
                                style={{
                                    width: "100%", padding: "0.4rem 0.5rem",
                                    borderRadius: "4px", border: "1px solid var(--border)",
                                    background: "var(--bg)", color: "var(--text)",
                                    fontSize: "0.85rem",
                                }}
                            />
                        </div>
                    ))}

                    <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.85rem" }}>
                        <input
                            type="checkbox"
                            checked={emailConfig.imap_ssl}
                            onChange={e => setEmailConfig(c => ({ ...c, imap_ssl: e.target.checked }))}
                        />
                        Use SSL
                    </label>

                    <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.85rem" }}>
                        <input
                            type="checkbox"
                            checked={emailConfig.auto_triage}
                            onChange={e => setEmailConfig(c => ({ ...c, auto_triage: e.target.checked }))}
                        />
                        Automatically triage incoming emails
                    </label>
                </div>

                <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem", flexWrap: "wrap" }}>
                    <button
                        className="scope-action-btn"
                        disabled={emailTesting}
                        onClick={async () => {
                            setEmailTesting(true);
                            setEmailTestResult(null);
                            try {
                                setEmailTestResult(await testEmailConfig());
                            } catch {
                                setEmailTestResult({ success: false, message: "Request failed" });
                            } finally {
                                setEmailTesting(false);
                            }
                        }}
                    >
                        {emailTesting ? "Testing…" : "Test Connection"}
                    </button>
                    <button
                        className="scope-action-btn"
                        disabled={emailSaving}
                        onClick={async () => {
                            setEmailSaving(true);
                            try {
                                await saveEmailConfig(emailConfig);
                            } finally {
                                setEmailSaving(false);
                            }
                        }}
                    >
                        {emailSaving ? "Saving…" : "Save"}
                    </button>
                </div>

                {emailTestResult && (
                    <p style={{ fontSize: "0.8rem", marginTop: "0.5rem", color: emailTestResult.success ? "var(--accent)" : "var(--color-error, #ef4444)" }}>
                        {emailTestResult.success ? "✓" : "✗"} {emailTestResult.message}
                    </p>
                )}
            </section>

            <section className="drawer-section">
                <h2>SMTP CONFIGURATION</h2>
                <p style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginBottom: "0.75rem" }}>
                    Required for sending emails (compose, reply, forward).
                </p>

                <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
                    <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.85rem" }}>
                        <input
                            type="checkbox"
                            checked={smtpConfig.enabled}
                            onChange={e => setSmtpConfig(c => ({ ...c, enabled: e.target.checked }))}
                        />
                        Enable sending
                    </label>

                    {[
                        { label: "SMTP Host", key: "smtp_host", type: "text", placeholder: "smtp.gmail.com" },
                        { label: "Port", key: "smtp_port", type: "number", placeholder: "587" },
                        { label: "Username / Email", key: "username", type: "email", placeholder: "you@example.com" },
                        { label: "Password / App password", key: "password", type: "password", placeholder: "••••••••" },
                        { label: "From name (optional)", key: "from_name", type: "text", placeholder: "Your Name" },
                        { label: "From email (optional, defaults to username)", key: "from_email", type: "email", placeholder: "you@example.com" },
                    ].map(({ label, key, type, placeholder }) => (
                        <div key={key}>
                            <label style={{ fontSize: "0.75rem", color: "var(--text-muted)", display: "block", marginBottom: "0.2rem" }}>
                                {label}
                            </label>
                            <input
                                type={type}
                                value={String((smtpConfig as Record<string, unknown>)[key] ?? "")}
                                onChange={e => setSmtpConfig(c => ({ ...c, [key]: type === "number" ? parseInt(e.target.value) || 0 : e.target.value }))}
                                placeholder={placeholder}
                                style={{
                                    width: "100%", padding: "0.4rem 0.5rem",
                                    borderRadius: "4px", border: "1px solid var(--border)",
                                    background: "var(--bg)", color: "var(--text)",
                                    fontSize: "0.85rem",
                                }}
                            />
                        </div>
                    ))}

                    <div style={{ display: "flex", gap: "1rem" }}>
                        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.85rem" }}>
                            <input
                                type="checkbox"
                                checked={smtpConfig.smtp_starttls}
                                onChange={e => setSmtpConfig(c => ({ ...c, smtp_starttls: e.target.checked, smtp_ssl: e.target.checked ? false : c.smtp_ssl }))}
                            />
                            STARTTLS
                        </label>
                        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.85rem" }}>
                            <input
                                type="checkbox"
                                checked={smtpConfig.smtp_ssl}
                                onChange={e => setSmtpConfig(c => ({ ...c, smtp_ssl: e.target.checked, smtp_starttls: e.target.checked ? false : c.smtp_starttls }))}
                            />
                            SSL/TLS (port 465)
                        </label>
                    </div>
                </div>

                <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem" }}>
                    <button
                        className="scope-action-btn"
                        disabled={smtpTesting || smtpSaving}
                        onClick={async () => {
                            setSmtpTesting(true);
                            setSmtpTestResult(null);
                            try {
                                await saveSmtpConfig(smtpConfig);
                                setSmtpTestResult(await testSmtpConfig());
                            } catch {
                                setSmtpTestResult({ success: false, message: "Request failed" });
                            } finally {
                                setSmtpTesting(false);
                            }
                        }}
                    >
                        {smtpTesting ? "Testing…" : "Test Connection"}
                    </button>
                    <button
                        className="scope-action-btn"
                        disabled={smtpSaving}
                        onClick={async () => {
                            setSmtpSaving(true);
                            setSmtpTestResult(null);
                            try {
                                await saveSmtpConfig(smtpConfig);
                                setSmtpTestResult({ success: true, message: "Settings saved." });
                            } catch {
                                setSmtpTestResult({ success: false, message: "Failed to save." });
                            } finally {
                                setSmtpSaving(false);
                            }
                        }}
                    >
                        {smtpSaving ? "Saving…" : "Save"}
                    </button>
                </div>

                {smtpTestResult && (
                    <p style={{ fontSize: "0.8rem", marginTop: "0.5rem", color: smtpTestResult.success ? "var(--accent)" : "var(--color-error, #ef4444)" }}>
                        {smtpTestResult.success ? "✓" : "✗"} {smtpTestResult.message}
                    </p>
                )}
            </section>
        </>
    );
}
