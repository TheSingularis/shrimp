import { useEffect, useState, useRef } from "react";
import { Check, Plus, Sparkles, Trash2, X } from "lucide-react";
import {
    getChecklist,
    createChecklistItem,
    toggleChecklistItem,
    deleteChecklistItem,
    clearCompletedItems,
    triageChecklist,
    type ChecklistItem,
} from "../api";
import { UrgencyBadge, toUrgencyLevel } from "../utils/urgency";

type Panel = "chat" | "dashboard" | "email" | "automations";

interface Props {
    onNavigate: (panel: Panel, emailId?: string) => void;
}


export function DailyChecklist({ onNavigate }: Props) {
    const [items, setItems] = useState<ChecklistItem[]>([]);
    const [showCompleted, setShowCompleted] = useState(false);
    const [loading, setLoading] = useState(true);
    const [triaging, setTriaging] = useState(false);
    const [addingTask, setAddingTask] = useState(false);
    const [newTaskText, setNewTaskText] = useState("");
    const inputRef = useRef<HTMLInputElement>(null);

    async function loadItems() {
        try {
            const data = await getChecklist(showCompleted);
            setItems(data);
            return data;
        } catch (e) {
            console.error("Failed to load checklist:", e);
            return [];
        } finally {
            setLoading(false);
        }
    }

    async function handleTriage() {
        setTriaging(true);
        try {
            await triageChecklist();
            await loadItems();
        } catch (e) {
            console.error("Triage failed:", e);
        } finally {
            setTriaging(false);
        }
    }

    useEffect(() => {
        loadItems().then(data => {
            // Auto-triage if any items haven't been triaged yet
            if (data.some(i => !i.triage_done && !i.completed)) {
                handleTriage();
            }
        });
    }, [showCompleted]);

    // Reload when an automation signals it finished, then auto-triage new items
    useEffect(() => {
        async function onRefresh() {
            const data = await loadItems();
            if (data.some((i: ChecklistItem) => !i.triage_done && !i.completed)) {
                handleTriage();
            }
        }
        window.addEventListener("checklist-refresh", onRefresh);
        return () => window.removeEventListener("checklist-refresh", onRefresh);
    }, []);

    async function handleToggle(item: ChecklistItem) {
        // Optimistic update
        setItems(prev =>
            prev.map(i =>
                i.id === item.id ? { ...i, completed: !i.completed } : i
            )
        );

        try {
            await toggleChecklistItem(item.id, !item.completed);
            // Reload to get accurate state and handle filtering
            loadItems();
        } catch (e) {
            console.error("Failed to toggle item:", e);
            // Revert on error
            loadItems();
        }
    }

    async function handleDelete(id: string) {
        setItems(prev => prev.filter(i => i.id !== id));
        try {
            await deleteChecklistItem(id);
        } catch (e) {
            console.error("Failed to delete item:", e);
            loadItems();
        }
    }

    async function handleAddTask() {
        if (!newTaskText.trim()) return;

        try {
            const item = await createChecklistItem(newTaskText.trim());
            setItems(prev => [item, ...prev]);
            setNewTaskText("");
            setAddingTask(false);
        } catch (e) {
            console.error("Failed to add task:", e);
        }
    }

    async function handleClearCompleted() {
        try {
            await clearCompletedItems();
            loadItems();
        } catch (e) {
            console.error("Failed to clear completed:", e);
        }
    }

    function handleEmailClick(emailId: string) {
        onNavigate("email", emailId);
    }

    useEffect(() => {
        if (addingTask && inputRef.current) {
            inputRef.current.focus();
        }
    }, [addingTask]);

    const completedCount = items.filter(i => i.completed).length;

    return (
        <div className="mb-4">
            {/* Header */}
            <div className="flex items-center justify-between mb-2">
                <span
                    className="text-xs font-semibold uppercase tracking-wider"
                    style={{ color: "var(--color-text-muted)" }}
                >
                    Daily Focus
                </span>
                <div className="flex items-center gap-1">
                    <button
                        onClick={() => setShowCompleted(!showCompleted)}
                        className="btn-ghost text-xs"
                        style={{ padding: "2px 6px" }}
                    >
                        {showCompleted ? "Hide done" : (completedCount > 0 ? `${completedCount} done` : "Completed")}
                    </button>
                    {showCompleted && completedCount > 0 && (
                        <button
                            onClick={handleClearCompleted}
                            className="btn-ghost text-xs"
                            style={{ padding: "2px 6px", color: "var(--color-error)" }}
                            title="Clear completed"
                        >
                            <Trash2 size={12} />
                        </button>
                    )}
                    <button
                        onClick={handleTriage}
                        disabled={triaging}
                        className="btn-ghost"
                        style={{ padding: "2px 6px" }}
                        title="AI triage priorities"
                    >
                        <Sparkles size={13} style={{ color: triaging ? "var(--accent)" : undefined, opacity: triaging ? 0.7 : 1 }} />
                    </button>
                    <button
                        onClick={() => setAddingTask(true)}
                        className="btn-ghost"
                        style={{ padding: "2px 6px" }}
                        title="Add task"
                    >
                        <Plus size={14} />
                    </button>
                </div>
            </div>

            {/* Content */}
            {loading ? (
                <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
                    Loading...
                </p>
            ) : items.length === 0 && !addingTask ? (
                <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
                    No tasks for today. Add one to get started.
                </p>
            ) : (
                <div className="flex flex-col gap-1.5">
                    {/* Add task input */}
                    {addingTask && (
                        <div
                            style={{
                                borderLeft: "2px solid var(--accent)",
                                borderRadius: "0 6px 6px 0",
                                background: "rgba(255,255,255,0.02)",
                                padding: "9px 10px 9px 12px",
                                display: "flex",
                                alignItems: "center",
                                gap: "8px",
                            }}
                        >
                            <div
                                className="w-4 h-4 rounded shrink-0"
                                style={{ border: "1px solid var(--color-text-muted)", opacity: 0.4 }}
                            />
                            <input
                                ref={inputRef}
                                type="text"
                                value={newTaskText}
                                onChange={e => setNewTaskText(e.target.value)}
                                onKeyDown={e => {
                                    if (e.key === "Enter") handleAddTask();
                                    if (e.key === "Escape") {
                                        setAddingTask(false);
                                        setNewTaskText("");
                                    }
                                }}
                                placeholder="Add a task..."
                                className="flex-1 bg-transparent text-sm outline-none"
                                style={{ color: "var(--color-text)" }}
                            />
                            <button onClick={handleAddTask} className="btn-ghost" style={{ padding: "2px" }} disabled={!newTaskText.trim()}>
                                <Check size={14} />
                            </button>
                            <button onClick={() => { setAddingTask(false); setNewTaskText(""); }} className="btn-ghost" style={{ padding: "2px" }}>
                                <X size={14} />
                            </button>
                        </div>
                    )}

                    {/* Task items */}
                    {items.map(item => (
                        <ChecklistItemRow
                            key={item.id}
                            item={item}
                            onToggle={() => handleToggle(item)}
                            onDelete={() => handleDelete(item.id)}
                            onEmailClick={handleEmailClick}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

function ChecklistItemRow({
    item,
    onToggle,
    onDelete,
    onEmailClick,
}: {
    item: ChecklistItem;
    onToggle: () => void;
    onDelete: () => void;
    onEmailClick: (emailId: string) => void;
}) {
    const [hovering, setHovering] = useState(false);
    const borderColor = (() => {
        if (item.priority === "urgent") return "#ef4444";
        if (item.priority === "high") return "#f97316";
        return "var(--theme-primary)";
    })();

    let displayText = item.text;
    if (displayText.startsWith("- [ ] ") || displayText.startsWith("- [x] ")) {
        displayText = displayText.slice(6);
    }

    return (
        <div
            className="flex items-stretch dashboard-item"
            style={{
                borderLeft: `2px solid ${borderColor}`,
                opacity: item.completed ? 0.55 : 1,
            }}
            onMouseEnter={() => setHovering(true)}
            onMouseLeave={() => setHovering(false)}
        >
            {/* Checkbox */}
            <button
                onClick={onToggle}
                className={`btn-checkbox shrink-0${item.completed ? " checked" : ""}`}
                style={{ margin: "13px 0 12px 12px", alignSelf: "flex-start" }}
            >
                {item.completed && <Check size={10} />}
            </button>

            {/* Content */}
            <div className="flex-1 min-w-0 py-2.5 px-2.5">
                <div className="flex items-start justify-between gap-2 mb-0.5">
                    <p
                        className="text-sm leading-snug flex-1 min-w-0"
                        style={{
                            color: "var(--color-text)",
                            textDecoration: item.completed ? "line-through" : "none",
                        }}
                    >
                        {item.source === "news_digest" && item.context?.url ? (
                            <a
                                href={item.context.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{ color: "inherit", textDecoration: "underline", textDecorationColor: "var(--color-text-muted)" }}
                                onClick={e => e.stopPropagation()}
                            >
                                {displayText}
                            </a>
                        ) : displayText}
                    </p>
                    {item.triage_done && (
                        <UrgencyBadge urgency={toUrgencyLevel(item.priority)} size={10} />
                    )}
                </div>

                {/* Context row */}
                {(item.context?.from || item.context?.feed || item.rolled_over) && (
                    <p className="text-xs mt-0.5" style={{ color: "var(--color-text-muted)" }}>
                        {item.rolled_over && <span className="italic">from yesterday</span>}
                        {item.rolled_over && (item.context?.from || item.context?.feed) && " · "}
                        {item.context?.feed && (
                            <span>{item.context.feed}</span>
                        )}
                        {item.context?.from && (
                            <span
                                className={item.context.email_id ? "cursor-pointer hover:underline" : ""}
                                onClick={() => item.context.email_id && onEmailClick(item.context.email_id)}
                            >
                                {item.context.from}
                                {item.context.subject && ` re: ${item.context.subject}`}
                            </span>
                        )}
                    </p>
                )}
            </div>

            {/* Delete button */}
            <button
                onClick={onDelete}
                className="btn-ghost shrink-0 self-center"
                style={{ padding: "8px 8px", color: "var(--color-text-muted)", opacity: hovering ? 1 : 0, transition: "opacity 0.1s" }}
                title="Delete"
            >
                <X size={12} />
            </button>
        </div>
    );
}
