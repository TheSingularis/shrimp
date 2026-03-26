import { useState, useEffect, useRef } from "react";
import { getScopes, type Scope, type Message, getConversation, saveConversation } from "./api";
import { ChatPanel } from "./components/ChatPanel";
import { ScopeSelector } from "./components/ScopeSelector";
import { SettingsDrawer } from "./components/SettingsDrawer";
import { ConversationSidebar } from "./components/ConversationSidebar";
import "./index.css";

export default function App() {
    const [scopes, setScopes] = useState<Scope[]>([]);
    const [selectedScopes, setSelectedScopes] = useState<string[]>([]);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [sidebarOpen, setSidebarOpen] = useState(false);

    // Conversation state
    const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
    const [messages, setMessages] = useState<Message[]>([]);
    const saveTimeoutRef = useRef<number | null>(null);

    useEffect(() => {
        getScopes().then((data) => {
            setScopes(data);
            // default: select all enabled scopes
            setSelectedScopes(data.filter((s) => s.enabled).map((s) => s.name));
        });
    }, []);

    // Auto-save conversation when messages change
    useEffect(() => {
        if (messages.length === 0) return;

        // Debounce save (1 second after last message)
        if (saveTimeoutRef.current !== null) {
            clearTimeout(saveTimeoutRef.current);
        }

        saveTimeoutRef.current = window.setTimeout(async () => {
            try {
                const result = await saveConversation(
                    messages,
                    selectedScopes,
                    currentConversationId ?? undefined
                );
                // Update conversation ID if this was a new conversation
                if (!currentConversationId) {
                    setCurrentConversationId(result.conversation_id);
                }
            } catch (error) {
                console.error("Failed to auto-save conversation:", error);
            }
        }, 1000);
    }, [messages, selectedScopes, currentConversationId]);

    function handleScopesChanged(updated: Scope[]) {
        setScopes(updated);
        setSelectedScopes(updated.filter((s) => s.enabled).map((s) => s.name));
    }

    async function handleLoadConversation(id: string) {
        try {
            const conv = await getConversation(id);
            setMessages(conv.messages);
            setCurrentConversationId(conv.conversation_id);
            setSelectedScopes(conv.active_scopes);
            setSidebarOpen(false);
        } catch (error) {
            console.error("Failed to load conversation:", error);
            alert("Failed to load conversation");
        }
    }

    function handleNewConversation() {
        setMessages([]);
        setCurrentConversationId(null);
        setSidebarOpen(false);
    }

    return (
        <div className="app">
            <ConversationSidebar
                open={sidebarOpen}
                onToggle={() => setSidebarOpen(!sidebarOpen)}
                currentConversationId={currentConversationId}
                onSelectConversation={handleLoadConversation}
                onNewConversation={handleNewConversation}
            />

            <header>
                <h1>SHRIMP<span className="asterisk">*</span></h1>
                <ScopeSelector
                    scopes={scopes}
                    selected={selectedScopes}
                    onChange={setSelectedScopes}
                />
                <button className="settings-btn" onClick={() => setSettingsOpen(true)}>
                    ⚙
                </button>
            </header>
            <main>
                <ChatPanel
                    scopes={selectedScopes}
                    messages={messages}
                    onMessagesChange={setMessages}
                />
            </main>

            <SettingsDrawer
                open={settingsOpen}
                onClose={() => setSettingsOpen(false)}
                onScopesChanged={handleScopesChanged}
            />
        </div>
    );
}
