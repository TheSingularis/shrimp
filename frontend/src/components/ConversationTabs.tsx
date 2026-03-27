import "./ConversationTabs.css";

interface ConversationTab {
    id: string;
    conversationId: string | null;
    title: string;
    messages: any[];
    selectedScopes: string[];
}

interface Props {
    tabs: ConversationTab[];
    activeTabId: string;
    onSelectTab: (id: string) => void;
    onCloseTab: (id: string) => void;
    onNewTab: () => void;
}

export function ConversationTabs({ tabs, activeTabId, onSelectTab, onCloseTab, onNewTab }: Props) {
    return (
        <div className="conversation-tabs">
            {tabs.map((tab) => (
                <div
                    key={tab.id}
                    className={`conversation-tab ${tab.id === activeTabId ? "active" : ""}`}
                    onClick={() => onSelectTab(tab.id)}
                >
                    <span className="conversation-tab-title">{tab.title}</span>
                    <button
                        className="conversation-tab-close"
                        onClick={(e) => {
                            e.stopPropagation();
                            onCloseTab(tab.id);
                        }}
                    >
                        ✕
                    </button>
                </div>
            ))}
            <button className="new-tab-btn" onClick={onNewTab}>
                +
            </button>
        </div>
    );
}
