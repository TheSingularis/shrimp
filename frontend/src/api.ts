const BASE = `http://${window.location.hostname}:8000`;

export interface Scope {
    name: string;
    path: string;
    enabled: boolean;
    description?: string;
}

export interface Message {
    role: "user" | "assistant";
    content: string;
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
}

export interface ConversationFull {
    conversation_id: string;
    title: string;
    messages: Message[];
    created_at: string;
    updated_at: string;
    active_scopes: string[];
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
    activeScopes: string[],
    conversationId?: string,
    title?: string
): Promise<{ conversation_id: string; title: string }> {
    const res = await fetch(`${BASE}/conversations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            conversation_id: conversationId,
            title,
            messages: messages.map((m) => ({ role: m.role, content: m.content })),
            active_scopes: activeScopes,
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
