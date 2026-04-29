const BASE = `http://${window.location.hostname || 'localhost'}:8000`;

export interface Scope {
    name: string;
    path: string;
    enabled: boolean;
    description?: string;
}

export interface Message {
    id: string;              // UUID v4
    role: "user" | "assistant";
    content: string;
    parentId: string | null; // null for root message
    createdAt: string;       // ISO8601
}

export interface FileEdit {
    scope: string;
    original: string;
    current: string;
    status: "pending" | "applied" | "discarded";
}

export interface AssistantMessage extends Message {
    role: "assistant";
    fileEdits?: { [path: string]: FileEdit };
}

export interface IndexStatus {
    name: string;
    path: string;
    file_count: number | null;
    last_indexed: string | null;
}

export interface PendingFile {
    path: string;
    content: string;
    scope: string;
}

export interface OllamaHostSetting {
    mode: "local" | "external";
    external_url: string;
}

export async function getScopes(): Promise<Scope[]> {
    const res = await fetch(`${BASE}/scopes`);
    return res.json();
}

export async function setScopes(scopes: Scope[]): Promise<Scope[]> {
    const res = await fetch(`${BASE}/settings/scopes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scopes }),
    });
    return res.json();
}

export async function getModels(): Promise<{ models: string[]; active: string }> {
    const res = await fetch(`${BASE}/models`);
    return res.json();
}

export async function setModel(model: string): Promise<void> {
    const res = await fetch(`${BASE}/settings/model`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model }),
    });

    if (!res.ok) {
        const error = await res.json();
        throw new Error(error.detail || `Failed to set model: ${res.status}`);
    }
}

export async function deleteScope(name: string): Promise<Scope[]> {
    const res = await fetch(`${BASE}/settings/scopes/${name}`, {
        method: "DELETE",
    });
    return res.json();
}

export async function sendChat(
    message: string,
    scopes: string[],
    history: Message[],
    onToken: (token: string) => void,
    pendingFile?: PendingFile,
    conversationId?: string | null,
    signal?: AbortSignal,
): Promise<void> {
    const res = await fetch(`${BASE}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            message,
            scopes,
            history: history.map((m) => ({ role: m.role, content: m.content })),
            pending_file: pendingFile ?? null,
            conversation_id: conversationId,
        }),
        signal,
    });
 
    if (!res.ok || !res.body) throw new Error(`sendChat: ${res.status}`);
 
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
 
    try{
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            onToken(decoder.decode(value, { stream: true }));
        }
    } finally {
        reader.cancel();
    }
}

export async function getIndexStatus(): Promise<IndexStatus[]> {
    const res = await fetch(`${BASE}/index/status`);
    return res.json();
}

export async function triggerIndexAll(): Promise<void> {
    await fetch(`${BASE}/index`, { method: "POST" });
}

export async function triggerIndexOne(name: string): Promise<void> {
    await fetch(`${BASE}/index/${name}`, { method: "POST" });
}

export async function fetchFile(
    scope: string,
    path: string,
): Promise<{ scope: string; path: string; content: string }> {
    const res = await fetch(
        `${BASE}/file?scope=${encodeURIComponent(scope)}&path=${encodeURIComponent(path)}`
    );
    if (!res.ok) throw new Error(`fetchFile: ${res.status}`);
    return res.json();
}

export async function pullModel(
    model: string,
    onProgress: (status: string, percent: number | null) => void
): Promise<void> {
    const res = await fetch(`${BASE}/models/pull`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model }),
    });

    if (!res.ok) {
        throw new Error(`Failed to pull model: ${res.status} ${res.statusText}`);
    }

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let lastError: string | null = null;

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
            if (!line.trim()) continue;
            try {
                const data = JSON.parse(line);

                // Check for error in Ollama response
                if (data.error) {
                    lastError = data.error;
                    throw new Error(data.error);
                }

                const percent = data.total
                    ? Math.round((data.completed / data.total) * 100)
                    : null;
                onProgress(data.status ?? "", percent);
            } catch (e) {
                // If it's our thrown error, re-throw it
                if (e instanceof Error && e.message === lastError) {
                    throw e;
                }
                // Otherwise ignore JSON parse errors
            }
        }
    }
}

export async function deleteModel(model: string): Promise<void> {
    await fetch(`${BASE}/models/${encodeURIComponent(model)}`, {
        method: "DELETE"
    });
}

export async function applyEdit(
    scope: string,
    path: string,
    content: string,
): Promise<void> {
    const res = await fetch(`${BASE}/file/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope, path, content }),
    });
    if (!res.ok) throw new Error(`applyEdit: ${res.status}`);
}

export async function getCtx(): Promise<number> {
    const res = await fetch(`${BASE}/settings/ctx`);
    if (!res.ok) throw new Error(`getCtx: ${res.status}`);
    return (await res.json()).num_ctx;
}

export async function setCtx(num_ctx: number): Promise<void> {
    const res = await fetch(`${BASE}/settings/ctx`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ num_ctx }),
    });
    if (!res.ok) throw new Error(`setCtx: ${res.status}`);
}

export async function getCustomInstructions(): Promise<string> {
    const res = await fetch(`${BASE}/settings/custom-instructions`);
    if (!res.ok) throw new Error(`getCustomInstructions: ${res.status}`);
    return (await res.json()).custom_instructions;
}

export async function setCustomInstructions(custom_instructions: string): Promise<void> {
    const res = await fetch(`${BASE}/settings/custom-instructions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ custom_instructions }),
    });
    if (!res.ok) throw new Error(`setCustomInstructions: ${res.status}`);
}

export async function getWebSearchEnabled(): Promise<boolean> {
    const res = await fetch(`${BASE}/settings/web-search`);
    if (!res.ok) throw new Error(`getWebSearchEnabled: ${res.status}`);
    return (await res.json()).enabled;
}

export async function setWebSearchEnabled(enabled: boolean): Promise<void> {
    const res = await fetch(`${BASE}/settings/web-search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
    });
    if (!res.ok) throw new Error(`setWebSearchEnabled: ${res.status}`);
}

export async function getTheme(): Promise<string> {
    const res = await fetch(`${BASE}/settings/theme`);
    if (!res.ok) throw new Error(`getTheme: ${res.status}`);
    return (await res.json()).theme;
}

export async function setTheme(theme: string): Promise<void> {
    const res = await fetch(`${BASE}/settings/theme`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ theme }),
    });
    if (!res.ok) throw new Error(`setTheme: ${res.status}`);
}

export async function getLanguage(): Promise<string> {
    const res = await fetch(`${BASE}/settings/language`);
    if (!res.ok) throw new Error(`getLanguage: ${res.status}`);
    return (await res.json()).language;
}

export async function setLanguage(language: string): Promise<void> {
    const res = await fetch(`${BASE}/settings/language`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language }),
    });
    if (!res.ok) throw new Error(`setLanguage: ${res.status}`);
}

export async function getOllamaHostSetting(): Promise<OllamaHostSetting> {
    const res = await fetch(`${BASE}/settings/ollama-host`);
    if (!res.ok) throw new Error("Failed to get Ollama host setting");
    return res.json();
}

export async function setOllamaHostSetting(
    mode: "local" | "external",
    externalUrl?: string
): Promise<void> {
    const res = await fetch(`${BASE}/settings/ollama-host`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            mode,
            external_url: externalUrl || "",
        }),
    });
    if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || "Failed to update Ollama host setting");
    }
}

export async function generateScopeDescription(name: string): Promise<string> {
    const res = await fetch(`${BASE}/scopes/${name}/generate-description`, {
        method: "POST",
    });
    if (!res.ok) throw new Error(`generateScopeDescription: ${res.status}`);
    return (await res.json()).description;
}

// ── Conversations ───────────────────────────────────────────────────────────────

export interface ConversationMetadata {
    conversation_id: string;
    title: string;
    created_at: string;
    updated_at: string;
    message_count: number;
    project_id: string | null;
}

export interface ConversationFull {
    conversation_id: string;
    title: string;
    messages: Message[];
    active_path: string[];   // Message IDs in current branch
    created_at: string;
    updated_at: string;
    active_scopes: string[];
    project_id: string | null;
}

export async function listConversations(): Promise<ConversationMetadata[]> {
    const res = await fetch(`${BASE}/conversations`);
    if (!res.ok) throw new Error(`listConversations: ${res.status}`);
    return res.json();
}

export async function getConversation(id: string): Promise<ConversationFull> {
    const res = await fetch(`${BASE}/conversations/${id}`);
    if (!res.ok) throw new Error(`getConversation: ${res.status}`);
    return res.json();
}

export async function saveConversation(
    messages: Message[],
    activePath: string[],
    activeScopes: string[],
    conversationId?: string,
    title?: string,
    projectId?: string | null
): Promise<{ conversation_id: string; title: string }> {
    const res = await fetch(`${BASE}/conversations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            conversation_id: conversationId,
            title,
            messages,  // Send full message objects with tree structure
            active_path: activePath,
            active_scopes: activeScopes,
            project_id: projectId,
        }),
    });
    if (!res.ok) throw new Error(`saveConversation: ${res.status}`);
    return res.json();
}

export async function deleteConversation(id: string): Promise<void> {
    const res = await fetch(`${BASE}/conversations/${id}`, {
        method: "DELETE",
    });
    if (!res.ok) throw new Error(`deleteConversation: ${res.status}`);
}

export async function updateConversationTitle(id: string, title: string): Promise<void> {
    const res = await fetch(`${BASE}/conversations/${id}/title`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
    });
    if (!res.ok) throw new Error(`updateConversationTitle: ${res.status}`);
}

// ── Projects ────────────────────────────────────────────────────────────────────

export interface ProjectSettings {
    default_scopes: string[];
    custom_instructions: string;
}

export interface Project {
    project_id: string;
    name: string;
    description: string;
    color: string;
    created_at: string;
    updated_at: string;
    settings: ProjectSettings;
}

export interface ProjectsData {
    projects: Project[];
    default_project_id: string | null;
}

export async function listProjects(): Promise<ProjectsData> {
    const res = await fetch(`${BASE}/projects`);
    if (!res.ok) throw new Error("Failed to list projects");
    return res.json();
}

export async function createProject(
    name: string,
    description?: string,
    color?: string,
    settings?: ProjectSettings
): Promise<Project> {
    const res = await fetch(`${BASE}/projects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            name,
            description: description || "",
            color: color || "#3b82f6",
            settings: settings || { default_scopes: [], custom_instructions: "" }
        }),
    });
    if (!res.ok) throw new Error("Failed to create project");
    return res.json();
}

export async function updateProject(
    projectId: string,
    updates: Partial<Omit<Project, "project_id" | "created_at" | "updated_at">>
): Promise<Project> {
    const res = await fetch(`${BASE}/projects/${projectId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
    });
    if (!res.ok) throw new Error("Failed to update project");
    return res.json();
}

export async function deleteProject(projectId: string): Promise<void> {
    const res = await fetch(`${BASE}/projects/${projectId}`, {
        method: "DELETE",
    });
    if (!res.ok) throw new Error("Failed to delete project");
}

export async function moveConversationToProject(
    conversationId: string,
    projectId: string | null
): Promise<void> {
    const res = await fetch(`${BASE}/conversations/${conversationId}/project`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: projectId }),
    });
    if (!res.ok) throw new Error("Failed to move conversation");
}

// ── Notifications ────────────────────────────────────────────────────────────

export interface Notification {
    id: string;
    created_at: string;
    read: boolean;
    priority: "high" | "normal" | "low";
    type: string;
    title: string;
    body: string;
    actions: { label: string; route: string }[];
    source: string;
}

export async function listNotifications(limit = 50): Promise<Notification[]> {
    const res = await fetch(`${BASE}/notifications?limit=${limit}`);
    if (!res.ok) throw new Error("Failed to list notifications");
    return res.json();
}

export async function dismissNotification(id: string): Promise<void> {
    await fetch(`${BASE}/notifications/${id}/dismiss`, { method: "POST" });
}

export async function deleteNotification(id: string): Promise<void> {
    await fetch(`${BASE}/notifications/${id}`, { method: "DELETE" });
}

// ── Automations ───────────────────────────────────────────────────────────────

export interface Automation {
    name: string;
    description: string;
    cron: string;
    enabled: boolean;
    last_run: string | null;
    last_result: "ok" | "error" | null;
    running: boolean;
}

export async function listAutomations(): Promise<Automation[]> {
    const res = await fetch(`${BASE}/automations`);
    if (!res.ok) throw new Error("Failed to list automations");
    return res.json();
}

export async function triggerAutomation(name: string): Promise<void> {
    const res = await fetch(`${BASE}/automations/${encodeURIComponent(name)}/run`, { method: "POST" });
    if (!res.ok) throw new Error(`Failed to trigger automation: ${name}`);
}

//TODO: persist cron changes, last_result, and last_run
export async function updateAutomation(name: string, updates: { enabled?: boolean; cron?: string }): Promise<Automation> {
    const res = await fetch(`${BASE}/automations/${encodeURIComponent(name)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
    });
    if (!res.ok) throw new Error(`Failed to update automation: ${name}`);
    return res.json();
}

// ── Checklist ─────────────────────────────────────────────────────────────────

export interface ChecklistItem {
    id: string;
    text: string;
    completed: boolean;
    completed_at: string | null;
    created_at: string;
    due_date: string;
    source: "email_digest" | "news_digest" | "calendar" | "manual";
    source_ref: string | null;
    priority: "urgent" | "high" | "normal" | "low";
    triage_done?: boolean;
    context: {
        from?: string;
        subject?: string;
        email_id?: string;
        rolled_from?: string;
        feed?: string;
        url?: string;
    };
    rolled_over?: boolean;
}

export async function getChecklist(includeCompleted = false): Promise<ChecklistItem[]> {
    const params = includeCompleted ? "?include_completed=true" : "";
    const res = await fetch(`${BASE}/checklist${params}`);
    if (!res.ok) throw new Error("Failed to get checklist");
    return res.json();
}

export async function createChecklistItem(
    text: string,
    priority: "urgent" | "high" | "normal" | "low" = "normal"
): Promise<ChecklistItem> {
    const res = await fetch(`${BASE}/checklist`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, priority }),
    });
    if (!res.ok) throw new Error("Failed to create checklist item");
    return res.json();
}

export async function toggleChecklistItem(id: string, completed: boolean): Promise<ChecklistItem> {
    const res = await fetch(`${BASE}/checklist/${id}/toggle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ completed }),
    });
    if (!res.ok) throw new Error("Failed to toggle checklist item");
    return res.json();
}

export async function deleteChecklistItem(id: string): Promise<void> {
    const res = await fetch(`${BASE}/checklist/${id}`, { method: "DELETE" });
    if (!res.ok) throw new Error("Failed to delete checklist item");
}

export async function clearCompletedItems(): Promise<{ cleared: number }> {
    const res = await fetch(`${BASE}/checklist/clear-completed`, { method: "POST" });
    if (!res.ok) throw new Error("Failed to clear completed items");
    return res.json();
}

export async function triageChecklist(): Promise<{ triaged: number }> {
    const res = await fetch(`${BASE}/checklist/triage`, { method: "POST" });
    if (!res.ok) throw new Error("Failed to triage checklist");
    return res.json();
}

// ── Obsidian ──────────────────────────────────────────────────────────────────

export interface ObsidianPage {
    path: string;
    title: string;
    size: number;
    modified: number;
    has_frontmatter: boolean;
    tags: string[];
}

export interface ObsidianPageFull extends ObsidianPage {
    frontmatter: Record<string, string>;
    body: string;
    content: string;
    broken_links: string[];
}

export async function listObsidianPages(scope?: string): Promise<{ pages: ObsidianPage[]; scope: string | null }> {
    const params = scope ? `?scope=${encodeURIComponent(scope)}` : "";
    const res = await fetch(`${BASE}/obsidian/pages${params}`);
    if (!res.ok) throw new Error("Failed to list vault pages");
    return res.json();
}

export async function getObsidianPage(scope: string, path: string): Promise<ObsidianPageFull> {
    const res = await fetch(
        `${BASE}/obsidian/page?scope=${encodeURIComponent(scope)}&path=${encodeURIComponent(path)}`
    );
    if (!res.ok) throw new Error("Page not found");
    return res.json();
}

export async function searchObsidian(query: string, scope?: string): Promise<{ results: string; scope: string }> {
    const res = await fetch(`${BASE}/obsidian/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, scope }),
    });
    if (!res.ok) throw new Error("Search failed");
    return res.json();
}

export interface PluginManifest {
    id: string;
    name: string;
    version: string;
    description?: string;
    category?: string;
    enabled: boolean;
}

export async function getPluginManifests(): Promise<PluginManifest[]> {
    const res = await fetch(`${BASE}/api/plugins`);
    if (!res.ok) throw new Error(`getPluginManifests: ${res.status}`);
    return (await res.json()).plugins;
}

export async function setPluginEnabled(id: string, enabled: boolean): Promise<void> {
    const res = await fetch(`${BASE}/api/plugins/${encodeURIComponent(id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
    });
    if (!res.ok) throw new Error(`setPluginEnabled: ${res.status}`);
}
