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
    onToken: (token: string) => void,
    pendingFile?: PendingFile,
    signal?: AbortSignal,
): Promise<void> {
    const res = await fetch("http://localhost:8000/chat", {
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
        `http://localhost:8000/file?scope=${encodeURIComponent(scope)}&path=${encodeURIComponent(path)}`
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

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

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
                const percent = data.total
                    ? Math.round((data.completed / data.total) * 100)
                    : null;
                onProgress(data.status ?? "", percent);
            } catch {}
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
    const res = await fetch("http://localhost:8000/file/apply", {
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
