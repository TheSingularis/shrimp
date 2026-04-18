import { AlertTriangle, ArrowUp, ArrowDown, Minus, Ban } from "lucide-react";

export type UrgencyLevel = "urgent" | "high" | "normal" | "low" | "spam";

export const URGENCY_CONFIG: Record<UrgencyLevel, {
    label: string;
    color: string;
    bg: string;
    icon: React.ReactNode;
}> = {
    urgent: { label: "Urgent", color: "#ef4444", bg: "rgba(239,68,68,0.12)",    icon: <AlertTriangle size={11} /> },
    high:   { label: "High",   color: "#f97316", bg: "rgba(249,115,22,0.12)",   icon: <ArrowUp size={11} /> },
    normal: { label: "Normal", color: "var(--color-text-muted)", bg: "rgba(128,128,128,0.10)", icon: <Minus size={11} /> },
    low:    { label: "Low",    color: "var(--color-text-muted)", bg: "rgba(128,128,128,0.08)", icon: <ArrowDown size={11} /> },
    spam:   { label: "Spam",   color: "var(--color-text-muted)", bg: "rgba(128,128,128,0.06)", icon: <Ban size={11} /> },
};

export const PRIORITY_ORDER: Record<string, number> = {
    urgent: 0, high: 1, normal: 2, low: 3, spam: 4,
};

export function toUrgencyLevel(p: string | undefined): UrgencyLevel {
    if (p === "urgent" || p === "high" || p === "normal" || p === "low" || p === "spam") return p;
    return "normal";
}

/** Inline badge showing urgency level with icon. */
export function UrgencyBadge({ urgency, size = 11 }: { urgency: string; size?: number }) {
    const cfg = URGENCY_CONFIG[urgency as UrgencyLevel] ?? URGENCY_CONFIG.normal;
    return (
        <span
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-semibold shrink-0"
            style={{ fontSize: `${size}px`, color: cfg.color, background: cfg.bg }}
        >
            {cfg.icon}{cfg.label}
        </span>
    );
}
