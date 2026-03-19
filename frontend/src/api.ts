const BASE = "http://localhost:8000";

export interface Scope {
    name: string;
    path: string;
    enabled: boolean;
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
    await fetch(`${BASE}/settings/model`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model }),
    });
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
    onToken: (token: string) => void
): Promise<void> {
    const res = await fetch(`${BASE}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, scopes, history }),
    });

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        onToken(decoder.decode(value));
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
