import { useEffect, useState, useRef } from "react";
import { Check, Plus, Trash2, X } from "lucide-react";
import {
    getChecklist,
    createChecklistItem,
    toggleChecklistItem,
    deleteChecklistItem,
    clearCompletedItems,
    type ChecklistItem,
} from "../api";

type Panel = "chat" | "dashboard" | "email" | "automations";

interface Props {
    onNavigate: (panel: Panel, emailId?: string) => void;
}

const PRIORITY_COLORS: Record<string, string> = {
    urgent: "#ef4444",
    high: "#f97316",
    normal: "var(--color-text-muted)",
    low: "var(--color-text-muted)",
};

export function DailyChecklist({ onNavigate }: Props) {
    const [items, setItems] = useState<ChecklistItem[]>([]);
    const [showCompleted, setShowCompleted] = useState(false);
    const [loading, setLoading] = useState(true);
    const [addingTask, setAddingTask] = useState(false);
    const [newTaskText, setNewTaskText] = useState("");
    const inputRef = useRef<HTMLInputElement>(null);

    async function loadItems() {
        try {
            const data = await getChecklist(showCompleted);
            setItems(data);
        } catch (e) {
            console.error("Failed to load checklist:", e);
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        loadItems();
    }, [showCompleted]);

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
    const hasCompleted = completedCount > 0 || showCompleted;

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
                    {hasCompleted && (
                        <button
                            onClick={() => setShowCompleted(!showCompleted)}
                            className="btn-ghost text-xs"
                            style={{ padding: "2px 6px" }}
                        >
                            {showCompleted ? "Hide done" : `${completedCount} done`}
                        </button>
                    )}
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
            <div
                style={{
                    borderLeft: "2px solid var(--accent)",
                    borderRadius: "0 6px 6px 0",
                    padding: "10px 14px",
                    background: "rgba(255,255,255,0.02)",
                }}
            >
                {loading ? (
                    <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
                        Loading...
                    </p>
                ) : items.length === 0 && !addingTask ? (
                    <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
                        No tasks for today. Add one to get started.
                    </p>
                ) : (
                    <ul className="flex flex-col gap-1">
                        {/* Add task input */}
                        {addingTask && (
                            <li className="flex items-center gap-2">
                                <div
                                    className="w-4 h-4 rounded border flex items-center justify-center shrink-0"
                                    style={{
                                        borderColor: "var(--color-text-muted)",
                                        opacity: 0.5,
                                    }}
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
                                <button
                                    onClick={handleAddTask}
                                    className="btn-ghost"
                                    style={{ padding: "2px" }}
                                    disabled={!newTaskText.trim()}
                                >
                                    <Check size={14} />
                                </button>
                                <button
                                    onClick={() => {
                                        setAddingTask(false);
                                        setNewTaskText("");
                                    }}
                                    className="btn-ghost"
                                    style={{ padding: "2px" }}
                                >
                                    <X size={14} />
                                </button>
                            </li>
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
                    </ul>
                )}
            </div>
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
    const priorityColor = PRIORITY_COLORS[item.priority] || PRIORITY_COLORS.normal;
    const isHighPriority = item.priority === "urgent" || item.priority === "high";

    // Format display text
    let displayText = item.text;
    // Remove markdown checkbox prefix if present
    if (displayText.startsWith("- [ ] ") || displayText.startsWith("- [x] ")) {
        displayText = displayText.slice(6);
    }

    return (
        <li
            className="flex items-start gap-2 group"
            onMouseEnter={() => setHovering(true)}
            onMouseLeave={() => setHovering(false)}
        >
            {/* Checkbox */}
            <button
                onClick={onToggle}
                className="w-4 h-4 rounded border flex items-center justify-center shrink-0 mt-0.5"
                style={{
                    borderColor: item.completed ? "var(--accent)" : priorityColor,
                    background: item.completed ? "var(--accent)" : "transparent",
                }}
            >
                {item.completed && <Check size={10} style={{ color: "var(--color-bg)" }} />}
            </button>

            {/* Content */}
            <div className="flex-1 min-w-0">
                <p
                    className="text-sm leading-tight"
                    style={{
                        color: item.completed ? "var(--color-text-muted)" : "var(--color-text)",
                        textDecoration: item.completed ? "line-through" : "none",
                        opacity: item.completed ? 0.6 : 1,
                    }}
                >
                    {displayText}
                    {isHighPriority && (
                        <span
                            className="ml-1.5 text-[10px] uppercase font-medium"
                            style={{ color: priorityColor }}
                        >
                            {item.priority}
                        </span>
                    )}
                </p>

                {/* Context info */}
                {(item.context?.from || item.rolled_over) && (
                    <p
                        className="text-xs mt-0.5"
                        style={{ color: "var(--color-text-muted)", opacity: 0.7 }}
                    >
                        {item.rolled_over && (
                            <span className="italic">from yesterday</span>
                        )}
                        {item.rolled_over && item.context?.from && " · "}
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
            {hovering && (
                <button
                    onClick={onDelete}
                    className="btn-ghost shrink-0"
                    style={{ padding: "2px", color: "var(--color-text-muted)" }}
                    title="Delete"
                >
                    <X size={12} />
                </button>
            )}
        </li>
    );
}
