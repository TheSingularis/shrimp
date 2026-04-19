import { useState, useEffect, useRef } from "react";
import { getScopes, type Scope, type Message, getConversation, saveConversation, getTheme, listProjects, type Project } from "./api";
import { ChatPanel } from "./components/ChatPanel";
import { ScopeSelector } from "./components/ScopeSelector";
import { SettingsModal } from "./components/SettingsModal";
import { ConversationSidebar } from "./components/ConversationSidebar";
import { ConversationTabs } from "./components/ConversationTabs";
import { DashboardHome } from "./components/DashboardHome";
import { AutomationsPanel } from "./components/AutomationsPanel";
import { EmailPanel } from "./components/EmailPanel";
import { NotificationFeed, NotificationBadge } from "./components/NotificationFeed";
import { useVisualViewport } from "./hooks/useVisualViewport";
import { useNotifications } from "./hooks/useNotifications";
import { TitleBar } from "./components/TitleBar";
import { Settings, LayoutDashboard, MessageSquare, Mail, BriefcaseBusiness } from "lucide-react";
import "./index.css";

type Panel = "dashboard" | "chat" | "email" | "automations";

interface ConversationTab {
    id: string;
    conversationId: string | null;
    projectId: string | null;
    title: string;
    messages: Message[];
    activePath: string[];
    selectedScopes: string[];
}

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

// ── Nav rail item ─────────────────────────────────────────────────────────────

function NavItem({ icon, label, active, onClick }: {
    icon: React.ReactNode;
    label: string;
    active: boolean;
    onClick: () => void;
}) {
    return (
        <button
            onClick={onClick}
            title={label}
            className="nav-btn flex flex-col items-center justify-center gap-1"
            style={{
                width: '44px',
                height: '44px',
                background: active ? 'var(--theme-accent-dim)' : 'transparent',
                color: active ? 'var(--accent)' : 'var(--color-text-muted)',
            }}
        >
            {icon}
            <span style={{ fontSize: '9px', fontWeight: 500, lineHeight: 1 }} className="hidden sm:block">{label}</span>
        </button>
    );
}

// ── Placeholder panel for not-yet-built pages ─────────────────────────────────

function PlaceholderPanel({ label, icon }: { label: string; icon: React.ReactNode }) {
    return (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 p-8">
            <span style={{ color: 'var(--color-text-muted)' }}>{icon}</span>
            <p className="text-lg font-semibold">{label}</p>
            <p className="text-sm text-center max-w-xs" style={{ color: 'var(--color-text-muted)' }}>
                This panel is coming in a future phase. Check back soon!
            </p>
        </div>
    );
}

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {
    const [activePanel, setActivePanel] = useState<Panel>("dashboard");
    const [selectedEmailId, setSelectedEmailId] = useState<string | null>(null);
    const [scopes, setScopes] = useState<Scope[]>([]);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [notifOpen, setNotifOpen] = useState(false);
    const [projects, setProjects] = useState<Project[]>([]);

    const { notifications, unreadCount, connected, dismiss: dismissNotif, remove: removeNotif } = useNotifications();

    // Tab state
    const [tabs, setTabs] = useState<ConversationTab[]>([]);
    const [activeTabId, setActiveTabId] = useState<string>("");
    const saveTimeoutRef = useRef<number | null>(null);

    const appContainerRef = useRef<HTMLDivElement>(null);
    useVisualViewport(appContainerRef);

    useEffect(() => {
        getTheme().then((theme) => {
            document.documentElement.className = `theme-${theme}`;
        }).catch(() => {
            document.documentElement.className = "theme-shrimp";
        });

        listProjects().then((data) => {
            setProjects(data.projects);
        });

        getScopes().then((data) => {
            setScopes(data);
            const enabledScopes = data.filter((s) => s.enabled).map((s) => s.name);
            const initialTab: ConversationTab = {
                id: generateTabId(),
                conversationId: null,
                projectId: null,
                title: "New Conversation",
                messages: [],
                activePath: [],
                selectedScopes: enabledScopes,
            };
            setTabs([initialTab]);
            setActiveTabId(initialTab.id);
        });
    }, []);

    const getActiveTab = (): ConversationTab | undefined => tabs.find(t => t.id === activeTabId);

    const updateActiveTab = (updates: Partial<ConversationTab>) => {
        setTabs(prev => prev.map(tab =>
            tab.id === activeTabId ? { ...tab, ...updates } : tab
        ));
    };

    useEffect(() => {
        const activeTab = getActiveTab();
        if (!activeTab || activeTab.messages.length === 0) return;

        if (saveTimeoutRef.current !== null) clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = window.setTimeout(async () => {
            try {
                const result = await saveConversation(
                    activeTab.messages,
                    activeTab.activePath,
                    activeTab.selectedScopes,
                    activeTab.conversationId ?? undefined,
                    undefined,
                    activeTab.projectId
                );
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

    async function saveCurrentTab() {
        const activeTab = getActiveTab();
        if (!activeTab || activeTab.messages.length === 0) return;
        try {
            const result = await saveConversation(
                activeTab.messages,
                activeTab.activePath,
                activeTab.selectedScopes,
                activeTab.conversationId ?? undefined,
                undefined,
                activeTab.projectId
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

    const createNewTab = () => {
        const enabledScopes = scopes.filter((s) => s.enabled).map((s) => s.name);
        const newTab: ConversationTab = {
            id: generateTabId(),
            conversationId: null,
            projectId: null,
            title: "New Conversation",
            messages: [],
            activePath: [],
            selectedScopes: enabledScopes,
        };
        setTabs(prev => [...prev, newTab]);
        setActiveTabId(newTab.id);
    };

    const switchTab = async (id: string) => {
        if (id === activeTabId) return;
        await saveCurrentTab();
        setActiveTabId(id);
    };

    const closeTab = async (id: string) => {
        const tabIndex = tabs.findIndex(t => t.id === id);
        if (tabIndex === -1) return;
        if (id === activeTabId) await saveCurrentTab();

        const newTabs = tabs.filter(t => t.id !== id);
        if (newTabs.length === 0) {
            const enabledScopes = scopes.filter((s) => s.enabled).map((s) => s.name);
            const newTab: ConversationTab = {
                id: generateTabId(),
                conversationId: null,
                projectId: null,
                title: "New Conversation",
                messages: [],
                activePath: [],
                selectedScopes: enabledScopes,
            };
            setTabs([newTab]);
            setActiveTabId(newTab.id);
            return;
        }
        setTabs(newTabs);
        if (id === activeTabId) {
            const newActiveIndex = tabIndex >= newTabs.length ? newTabs.length - 1 : tabIndex;
            setActiveTabId(newTabs[newActiveIndex].id);
        }
    };

    function handleScopesChanged(updated: Scope[]) {
        setScopes(updated);
        const enabledScopes = updated.filter((s) => s.enabled).map((s) => s.name);
        setTabs(prev => prev.map(tab =>
            tab.conversationId === null ? { ...tab, selectedScopes: enabledScopes } : tab
        ));
    }

    function handleScopeSelectionChange(selectedScopes: string[]) {
        updateActiveTab({ selectedScopes });
    }

    function handleConversationMoved(conversationId: string, projectId: string | null) {
        const tabIndex = tabs.findIndex(t => t.conversationId === conversationId);
        if (tabIndex !== -1) {
            const updatedTabs = [...tabs];
            const currentTab = updatedTabs[tabIndex];
            let selectedScopes = currentTab.selectedScopes;
            if (projectId) {
                const project = projects.find(p => p.project_id === projectId);
                if (project && project.settings.default_scopes.length > 0) {
                    selectedScopes = project.settings.default_scopes;
                }
            }
            updatedTabs[tabIndex] = { ...currentTab, projectId, selectedScopes };
            setTabs(updatedTabs);
        }
    }

    async function handleLoadConversation(id: string) {
        try {
            const existingTab = tabs.find(t => t.conversationId === id);
            if (existingTab) {
                switchTab(existingTab.id);
                setSidebarOpen(false);
                return;
            }
            const conv = await getConversation(id);
            let selectedScopes = conv.active_scopes;
            if (conv.project_id) {
                const project = projects.find(p => p.project_id === conv.project_id);
                if (project && project.settings.default_scopes.length > 0) {
                    selectedScopes = project.settings.default_scopes;
                }
            }
            const newTab: ConversationTab = {
                id: generateTabId(),
                conversationId: conv.conversation_id,
                projectId: conv.project_id,
                title: getDefaultTitle(conv.messages),
                messages: conv.messages,
                activePath: conv.active_path || [],
                selectedScopes,
            };
            await saveCurrentTab();
            setTabs(prev => {
                // Replace active tab only if it's an empty unsaved conversation, otherwise open alongside
                const active = prev.find(t => t.id === activeTabId);
                const activeEmpty = active && !active.conversationId && active.messages.length === 0;
                return activeEmpty
                    ? prev.map(t => t.id === activeTabId ? newTab : t)
                    : [...prev, newTab];
            });
            setActiveTabId(newTab.id);
            setSidebarOpen(false);
        } catch (error) {
            console.error("Failed to load conversation:", error);
            alert("Failed to load conversation");
        }
    }

    function handleNewConversation() {
        const emptyTab = tabs.find(t => t.conversationId === null && t.messages.length === 0);
        if (emptyTab) {
            switchTab(emptyTab.id);
            setSidebarOpen(false);
            return;
        }
        createNewTab();
        setSidebarOpen(false);
    }

    const activeTab = getActiveTab();

    const navItems: { panel: Panel; icon: React.ReactNode; label: string }[] = [
        { panel: "dashboard", icon: <LayoutDashboard size={18} />, label: "Home" },
        { panel: "chat",      icon: <MessageSquare size={18} />,   label: "Chat" },
        { panel: "email",     icon: <Mail size={18} />,            label: "Email" },
        { panel: "automations", icon: <BriefcaseBusiness size={18} />, label: "Automations" },
    ];

    const isElectron = !!(window as any).__shrimp__?.isElectron;

    return (
        <div style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column' }}>
            {isElectron && <TitleBar />}
            <div
                ref={appContainerRef}
                className="flex flex-1 bg-shrimp-bg text-shrimp-text antialiased overflow-hidden"
            >
            {/* ── Left nav rail ── */}
            <nav className="flex flex-col items-center gap-1 px-1.5 py-3 border-r border-shrimp-border bg-shrimp-surface/60 shrink-0 w-14 sm:w-16">
                <div className="mb-2">
                    <img src="./icons/shrimp(1).png" alt="SHRIMP" className="w-7 h-7" />
                </div>
                {navItems.map(item => (
                    <NavItem
                        key={item.panel}
                        icon={item.icon}
                        label={item.label}
                        active={activePanel === item.panel}
                        onClick={() => setActivePanel(item.panel)}
                    />
                ))}
                {/* Spacer pushes remaining items to the bottom */}
                <div className="flex-1" />
                <NotificationBadge count={unreadCount} onClick={() => setNotifOpen(true)} />
                <button
                    onClick={() => setSettingsOpen(true)}
                    className="nav-btn flex flex-col items-center justify-center gap-1"
                    title="Settings"
                    style={{ width: '44px', height: '44px', color: 'var(--color-text-muted)' }}
                >
                    <Settings size={18} style={{ color: 'var(--accent)' }} />
                    <span style={{ fontSize: '9px', fontWeight: 500, lineHeight: 1 }} className="hidden sm:block">Settings</span>
                </button>
            </nav>

            {/* ── Main content area ── */}
            <div className="flex flex-col flex-1 overflow-hidden min-w-0">

                {/* Chat-specific chrome: sidebar + header + tabs */}
                {activePanel === "chat" && (
                    <>
                        <ConversationSidebar
                            open={sidebarOpen}
                            onToggle={() => setSidebarOpen(!sidebarOpen)}
                            currentConversationId={activeTab?.conversationId ?? null}
                            onSelectConversation={handleLoadConversation}
                            onNewConversation={handleNewConversation}
                            projects={projects}
                            onProjectsChange={setProjects}
                            scopes={scopes}
                            onConversationMoved={handleConversationMoved}
                        />

                        <header className="shrink-0 flex items-center pl-3 md:pl-4 pr-2 md:pr-3 py-3 border-b border-shrimp-border bg-shrimp-surface/50 backdrop-blur-sm">
                            <div className="flex items-center gap-3 flex-1 min-w-0">
                                <h1 className="text-base font-bold tracking-tight shrink-0">
                                    SHRIMP<span style={{ color: 'var(--theme-primary)' }}>*</span>
                                </h1>
                                <ScopeSelector
                                    scopes={scopes}
                                    selected={activeTab?.selectedScopes ?? []}
                                    onChange={handleScopeSelectionChange}
                                />
                            </div>
                        </header>

                        {tabs.length > 0 && (
                            <ConversationTabs
                                tabs={tabs}
                                activeTabId={activeTabId}
                                onSelectTab={switchTab}
                                onCloseTab={closeTab}
                                onNewTab={createNewTab}
                            />
                        )}
                    </>
                )}

                {/* Panel content */}
                <main className="flex-1 overflow-hidden min-h-0 flex flex-col">
                    {activePanel === "dashboard" && (
                        <DashboardHome onNavigate={(p, emailId, conversationId) => {
                            setActivePanel(p as Panel);
                            if (emailId) setSelectedEmailId(emailId);
                            if (conversationId) handleLoadConversation(conversationId);
                        }} />
                    )}
                    {activePanel === "chat" && activeTab && (
                        <ChatPanel
                            scopes={activeTab.selectedScopes}
                            messages={activeTab.messages}
                            activePath={activeTab.activePath}
                            onMessagesChange={(msgs, path) => updateActiveTab({ messages: msgs, activePath: path })}
                            conversationId={activeTab.conversationId}
                        />
                    )}
                    {activePanel === "email" && (
                        <EmailPanel initialEmailId={selectedEmailId} onEmailOpened={() => setSelectedEmailId(null)} />
                    )}
                    {activePanel === "automations" && <AutomationsPanel />}
                </main>
            </div>

            {/* ── Overlays ── */}
            <NotificationFeed
                open={notifOpen}
                onClose={() => setNotifOpen(false)}
                onNavigate={(panel) => {
                    setActivePanel(panel as Panel);
                    setNotifOpen(false);
                }}
                notifications={notifications}
                unreadCount={unreadCount}
                connected={connected}
                onDismiss={dismissNotif}
                onDelete={removeNotif}
                topOffset={isElectron ? 32 : 0}
            />

            <SettingsModal
                open={settingsOpen}
                onClose={() => setSettingsOpen(false)}
                onScopesChanged={handleScopesChanged}
            />

        </div>
        </div>
    );
}
