import { useState, useEffect, useRef } from "react";
import { getScopes, type Scope, type Message, getConversation, saveConversation, getTheme } from "./api";
import { ChatPanel } from "./components/ChatPanel";
import { ScopeSelector } from "./components/ScopeSelector";
import { SettingsDrawer } from "./components/SettingsDrawer";
import { ConversationSidebar } from "./components/ConversationSidebar";
import { ConversationTabs } from "./components/ConversationTabs";
import { useVisualViewport } from "./hooks/useVisualViewport";
import { Settings } from "lucide-react";
import "./index.css";

interface ConversationTab {
    id: string;
    conversationId: string | null;
    title: string;
    messages: Message[];
    selectedScopes: string[];
}

// Helper functions
function generateTabId(): string {
    return `tab-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

function getDefaultTitle(messages: Message[]): string {
    if (messages.length === 0) return "New Conversation";
    const firstUserMessage = messages.find(m => m.role === "user");
    if (firstUserMessage) {
        const preview = firstUserMessage.content.slice(0, 30);
        return preview.length < firstUserMessage.content.length ? `${preview}...` : preview;
    }
    return "New Conversation";
}

export default function App() {
    const [scopes, setScopes] = useState<Scope[]>([]);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [sidebarOpen, setSidebarOpen] = useState(false);

    // Tab state
    const [tabs, setTabs] = useState<ConversationTab[]>([]);
    const [activeTabId, setActiveTabId] = useState<string>("");
    const saveTimeoutRef = useRef<number | null>(null);

    // Handle iOS keyboard with visualViewport API
    const appContainerRef = useRef<HTMLDivElement>(null);
    useVisualViewport(appContainerRef);

    useEffect(() => {
        // Load theme
        getTheme().then((theme) => {
            document.documentElement.className = `theme-${theme}`;
        }).catch(() => {
            // Default to blue-purple if theme loading fails
            document.documentElement.className = "theme-blue-purple";
        });

        getScopes().then((data) => {
            setScopes(data);
            // Create initial tab with all enabled scopes
            const enabledScopes = data.filter((s) => s.enabled).map((s) => s.name);
            const initialTab: ConversationTab = {
                id: generateTabId(),
                conversationId: null,
                title: "New Conversation",
                messages: [],
                selectedScopes: enabledScopes,
            };
            setTabs([initialTab]);
            setActiveTabId(initialTab.id);
        });
    }, []);

    // Get active tab
    const getActiveTab = (): ConversationTab | undefined => {
        return tabs.find(t => t.id === activeTabId);
    };

    // Update active tab
    const updateActiveTab = (updates: Partial<ConversationTab>) => {
        setTabs(prev => prev.map(tab =>
            tab.id === activeTabId ? { ...tab, ...updates } : tab
        ));
    };

    // Auto-save active tab when messages change
    useEffect(() => {
        const activeTab = getActiveTab();
        if (!activeTab || activeTab.messages.length === 0) return;

        // Debounce save (1 second after last message)
        if (saveTimeoutRef.current !== null) {
            clearTimeout(saveTimeoutRef.current);
        }

        saveTimeoutRef.current = window.setTimeout(async () => {
            try {
                const result = await saveConversation(
                    activeTab.messages,
                    activeTab.selectedScopes,
                    activeTab.conversationId ?? undefined
                );
                // Update conversation ID and title if this was a new conversation
                if (!activeTab.conversationId) {
                    updateActiveTab({
                        conversationId: result.conversation_id,
                        title: getDefaultTitle(activeTab.messages)
                    });
                }
            } catch (error) {
                console.error("Failed to auto-save conversation:", error);
            }
        }, 1000);
    }, [tabs, activeTabId]);

    // Save current tab before switching
    async function saveCurrentTab() {
        const activeTab = getActiveTab();
        if (!activeTab || activeTab.messages.length === 0) return;

        try {
            const result = await saveConversation(
                activeTab.messages,
                activeTab.selectedScopes,
                activeTab.conversationId ?? undefined
            );
            if (!activeTab.conversationId) {
                updateActiveTab({
                    conversationId: result.conversation_id,
                    title: getDefaultTitle(activeTab.messages)
                });
            }
        } catch (error) {
            console.error("Failed to save conversation:", error);
        }
    }

    // Create new tab
    const createNewTab = () => {
        const enabledScopes = scopes.filter((s) => s.enabled).map((s) => s.name);
        const newTab: ConversationTab = {
            id: generateTabId(),
            conversationId: null,
            title: "New Conversation",
            messages: [],
            selectedScopes: enabledScopes,
        };
        setTabs(prev => [...prev, newTab]);
        setActiveTabId(newTab.id);
    };

    // Switch to a tab
    const switchTab = async (id: string) => {
        if (id === activeTabId) return;
        await saveCurrentTab();
        setActiveTabId(id);
    };

    // Close a tab
    const closeTab = async (id: string) => {
        const tabIndex = tabs.findIndex(t => t.id === id);
        if (tabIndex === -1) return;

        // If closing active tab, save it first
        if (id === activeTabId) {
            await saveCurrentTab();
        }

        const newTabs = tabs.filter(t => t.id !== id);

        // If this was the last tab, replace with a new empty one
        if (newTabs.length === 0) {
            const enabledScopes = scopes.filter((s) => s.enabled).map((s) => s.name);
            const newTab: ConversationTab = {
                id: generateTabId(),
                conversationId: null,
                title: "New Conversation",
                messages: [],
                selectedScopes: enabledScopes,
            };
            setTabs([newTab]);
            setActiveTabId(newTab.id);
            return;
        }

        setTabs(newTabs);

        // If we closed the active tab, switch to adjacent tab
        if (id === activeTabId) {
            const newActiveIndex = tabIndex >= newTabs.length ? newTabs.length - 1 : tabIndex;
            setActiveTabId(newTabs[newActiveIndex].id);
        }
    };

    function handleScopesChanged(updated: Scope[]) {
        setScopes(updated);
        const enabledScopes = updated.filter((s) => s.enabled).map((s) => s.name);
        // Update all tabs to use enabled scopes by default (only for new conversations)
        setTabs(prev => prev.map(tab =>
            tab.conversationId === null ? { ...tab, selectedScopes: enabledScopes } : tab
        ));
    }

    function handleScopeSelectionChange(selectedScopes: string[]) {
        updateActiveTab({ selectedScopes });
    }

    async function handleLoadConversation(id: string) {
        try {
            // Check if conversation is already open in a tab
            const existingTab = tabs.find(t => t.conversationId === id);
            if (existingTab) {
                switchTab(existingTab.id);
                setSidebarOpen(false);
                return;
            }

            // Load conversation data
            const conv = await getConversation(id);

            // Create new tab with loaded conversation
            const newTab: ConversationTab = {
                id: generateTabId(),
                conversationId: conv.conversation_id,
                title: getDefaultTitle(conv.messages),
                messages: conv.messages,
                selectedScopes: conv.active_scopes,
            };

            await saveCurrentTab();
            setTabs(prev => [...prev, newTab]);
            setActiveTabId(newTab.id);
            setSidebarOpen(false);
        } catch (error) {
            console.error("Failed to load conversation:", error);
            alert("Failed to load conversation");
        }
    }

    function handleNewConversation() {
        // Check if there's already an empty unsaved tab
        const emptyTab = tabs.find(t => t.conversationId === null && t.messages.length === 0);
        if (emptyTab) {
            switchTab(emptyTab.id);
            setSidebarOpen(false);
            return;
        }

        // Create new tab
        createNewTab();
        setSidebarOpen(false);
    }

    const activeTab = getActiveTab();

    return (
        <div
            ref={appContainerRef}
            className="flex flex-col bg-shrimp-bg text-shrimp-text antialiased overflow-hidden"
            style={{ position: 'fixed', left: 0, right: 0, top: 0 }}
        >
            <ConversationSidebar
                open={sidebarOpen}
                onToggle={() => setSidebarOpen(!sidebarOpen)}
                currentConversationId={activeTab?.conversationId ?? null}
                onSelectConversation={handleLoadConversation}
                onNewConversation={handleNewConversation}
            />

            {/* Header - Modern Design */}
            <header className="shrink-0 flex items-center pl-4 md:pl-6 pr-2 md:pr-3 py-3 border-b border-shrimp-border bg-shrimp-surface/50 backdrop-blur-sm">
                <div className="flex items-center gap-4 flex-1">
                    <div className="flex items-center gap-2">
                        <img
                            src="/icons/shrimp(1).png"
                            alt="SHRIMP"
                            className="w-8 h-8"
                        />
                        <h1 className="text-lg font-bold tracking-tight">
                            SHRIMP<span style={{ color: 'var(--theme-primary)' }}>*</span>
                        </h1>
                    </div>
                    <ScopeSelector
                        scopes={scopes}
                        selected={activeTab?.selectedScopes ?? []}
                        onChange={handleScopeSelectionChange}
                    />
                </div>
                <button
                    onClick={() => setSettingsOpen(true)}
                    className="w-9 h-9 rounded-lg hover:bg-shrimp-surface transition-colors flex items-center justify-center shrink-0 text-2xl font-semibold"
                    title="Settings"
                    style={{ color: 'var(--color-text-muted)' }}
                >
                    ⚙
                </button>
            </header>

            {/* Conversation Tabs */}
            {tabs.length > 0 && (
                <ConversationTabs
                    tabs={tabs}
                    activeTabId={activeTabId}
                    onSelectTab={switchTab}
                    onCloseTab={closeTab}
                    onNewTab={createNewTab}
                />
            )}

            {/* Main Chat Area */}
            <main className="flex-1 overflow-hidden min-h-0">
                {activeTab && (
                    <ChatPanel
                        scopes={activeTab.selectedScopes}
                        messages={activeTab.messages}
                        onMessagesChange={(msgs) => updateActiveTab({ messages: msgs })}
                    />
                )}
            </main>

            <SettingsDrawer
                open={settingsOpen}
                onClose={() => setSettingsOpen(false)}
                onScopesChanged={handleScopesChanged}
            />
        </div>
    );
}
