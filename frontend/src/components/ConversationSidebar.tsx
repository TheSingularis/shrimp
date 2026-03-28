import { useState, useEffect } from "react";
import { type ConversationMetadata, listConversations, deleteConversation, updateConversationTitle } from "../api";
import { X, MessageSquarePlus } from "lucide-react";
import "./ConversationSidebar.css";

interface Props {
    open: boolean;
    onToggle: () => void;
    currentConversationId: string | null;
    onSelectConversation: (id: string) => void;
    onNewConversation: () => void;
}

export function ConversationSidebar({
    open,
    onToggle,
    currentConversationId,
    onSelectConversation,
    onNewConversation,
}: Props) {
    const [conversations, setConversations] = useState<ConversationMetadata[]>([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (open) {
            loadConversations();
        }
    }, [open]);

    async function loadConversations() {
        setLoading(true);
        try {
            const data = await listConversations();
            setConversations(data);
        } catch (error) {
            console.error("Failed to load conversations:", error);
        } finally {
            setLoading(false);
        }
    }

    async function handleDelete(id: string, e: React.MouseEvent) {
        e.stopPropagation();

        if (!confirm("Delete this conversation?")) return;

        try {
            await deleteConversation(id);
            setConversations(conversations.filter((c) => c.conversation_id !== id));

            // If deleting current conversation, start new one
            if (id === currentConversationId) {
                onNewConversation();
            }
        } catch (error) {
            console.error("Failed to delete conversation:", error);
            alert("Failed to delete conversation");
        }
    }

    async function handleRename(id: string, currentTitle: string, e: React.MouseEvent) {
        e.stopPropagation();

        const newTitle = prompt("Enter new title:", currentTitle);
        if (!newTitle || newTitle === currentTitle) return;

        try {
            await updateConversationTitle(id, newTitle);
            setConversations(conversations.map((c) =>
                c.conversation_id === id ? { ...c, title: newTitle } : c
            ));
        } catch (error) {
            console.error("Failed to rename conversation:", error);
            alert("Failed to rename conversation");
        }
    }

    function formatDate(dateString: string): string {
        const date = new Date(dateString);
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);

        if (diffMins < 1) return "Just now";
        if (diffMins < 60) return `${diffMins}m ago`;
        if (diffHours < 24) return `${diffHours}h ago`;
        if (diffDays < 7) return `${diffDays}d ago`;

        return date.toLocaleDateString();
    }

    return (
        <>
            {/* Toggle button */}
            <button
                onClick={onToggle}
                className="sidebar-toggle"
                title={open ? "Close sidebar" : "Open sidebar"}
            >
                {open ? "◀" : "▶"}
            </button>

            {/* Sidebar */}
            <div className={`conversation-sidebar ${open ? "open" : ""}`}>
                <div className="sidebar-header">
                    <h2>Conversations</h2>
                    <button onClick={onNewConversation} className="new-conversation-btn">
                        + New
                    </button>
                </div>

                <div className="conversation-list">
                    {loading ? (
                        <div className="loading">Loading...</div>
                    ) : conversations.length === 0 ? (
                        <div className="empty-state">No conversations yet</div>
                    ) : (
                        conversations.map((conv) => (
                            <div
                                key={conv.conversation_id}
                                className={`conversation-item ${
                                    conv.conversation_id === currentConversationId ? "active" : ""
                                }`}
                                onClick={() => onSelectConversation(conv.conversation_id)}
                            >
                                <div
                                    className="conversation-title"
                                    onDoubleClick={(e) => handleRename(conv.conversation_id, conv.title, e)}
                                    title="Double-click to rename"
                                >
                                    {conv.title}
                                </div>
                                <div className="conversation-meta">
                                    {formatDate(conv.updated_at)} · {conv.message_count} messages
                                </div>
                                <button
                                    className="delete-conversation-btn"
                                    onClick={(e) => handleDelete(conv.conversation_id, e)}
                                    title="Delete conversation"
                                >
                                    <X size={14} />
                                </button>
                            </div>
                        ))
                    )}
                </div>
            </div>

            {/* Overlay for mobile */}
            {open && <div className="sidebar-overlay" onClick={onToggle} />}
        </>
    );
}
