import { useState, useRef, useEffect } from "react";
import { type Message, sendChat, fetchFile, applyEdit, type PendingFile } from "../api";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import cliSpinners from "cli-spinners";
import { DiffPanel } from "./DiffPanel";

interface Props {
    scopes: string[];
}

// ── markdown components ────────────────────────────────────────────────────────

const mdComponents: Components = {
    pre({ children }) {
        return <>{children}</>;
    },
    code({
        className,
        children,
    }: React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>) {
        const match = /language-(\w+)/.exec(className || "");
        const lang = match?.[1];
        const raw = String(children).replace(/\n$/, "");

        if (lang && lang !== "markdown") {
            return (
                <div className="code-block-wrapper">
                    <div className="code-block-label">{lang}</div>
                    <SyntaxHighlighter
                        style={vscDarkPlus}
                        language={lang}
                        PreTag="div"
                        customStyle={{
                            margin: 0,
                            borderRadius: "0 0 6px 6px",
                            fontSize: "0.9rem",
                            border: "none",
                        }}
                    >
                        {raw}
                    </SyntaxHighlighter>
                </div>
            );
        }

        return <>{raw}</>;
    },
};

// ── types ──────────────────────────────────────────────────────────────────────

interface FileEditSentinel {
    type: "file_edit";
    scope: string;
    path: string;
    original: string;
    new: string;
}

interface FileEditAmbiguousSentinel {
    type: "file_edit_ambiguous";
    candidates: { scope: string; path: string }[];
    new: string;
}

type Sentinel = FileEditSentinel | FileEditAmbiguousSentinel;

interface AssistantMessage extends Message {
    role: "assistant";
    sentinel?: Sentinel;
    prose?: string;
}

type ChatMessage = Message | AssistantMessage;

// pending edit state — one entry per file path
interface PendingEdit {
    scope: string;
    path: string;
    original: string;   // disk content — never changes
    current: string;    // accumulated edits — updated on each follow-up
}

// ── sentinel parsing ───────────────────────────────────────────────────────────

const SENTINEL_PREFIX = "__SHRIMP_EDIT__";

function parseSentinel(content: string): {
    display: string;
    sentinel: Sentinel | null;
} {
    const idx = content.indexOf(SENTINEL_PREFIX);
    if (idx === -1) return { display: content, sentinel: null };

    const display = content.slice(0, idx).trim();
    const raw = content.slice(idx + SENTINEL_PREFIX.length);

    try {
        const sentinel = JSON.parse(raw) as Sentinel;
        const editMarkerIdx = display.indexOf("__EDIT_FILE__");
        const prose = editMarkerIdx !== -1
            ? display.slice(0, editMarkerIdx).trim()
            : display;
        return { display: prose, sentinel };
    } catch {
        return { display, sentinel: null };
    }
}

// ── component ──────────────────────────────────────────────────────────────────

export function ChatPanel({ scopes }: Props) {
    const [history, setHistory] = useState<ChatMessage[]>([]);
    const [input, setInput] = useState("");
    const [streaming, setStreaming] = useState(false);
    const [responseStarted, setResponseStarted] = useState(false);

    // per-file pending edits keyed by path
    const [pendingEdits, setPendingEdits] = useState<Record<string, PendingEdit>>({});

    // which file is currently shown in the diff panel (null = closed)
    const [activeDiffPath, setActiveDiffPath] = useState<string | null>(null);

    // apply state per file
    const [applying, setApplying] = useState<Record<string, boolean>>({});
    const [applied, setApplied] = useState<Record<string, boolean>>({});

    const bottomRef = useRef<HTMLDivElement>(null);
    const spinner = cliSpinners.bouncingBar;
    const [spinnerFrame, setSpinnerFrame] = useState(0);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [history]);

    useEffect(() => {
        if (streaming && !responseStarted) {
            const interval = setInterval(() => {
                setSpinnerFrame((prev) => (prev + 1) % spinner.frames.length);
            }, spinner.interval);
            return () => clearInterval(interval);
        }
    }, [streaming, responseStarted, spinner.frames.length, spinner.interval]);

    useEffect(() => {
        if (!streaming) {
            requestAnimationFrame(() => setSpinnerFrame(0));
        }
    }, [streaming]);

    async function submit() {
        if (!input.trim() || streaming) return;

        // augmented input is just the raw message — pending file context
        // is sent separately via pending_file field, not injected into the message text
        const augmentedInput = input;

        const userMessage: Message = { role: "user", content: input }; // display original
        const augmentedMessage: Message = { role: "user", content: augmentedInput }; // sent to API
        const newHistory = [...history, userMessage];

        setHistory([...newHistory, { role: "assistant", content: "" }]);
        setInput("");
        setStreaming(true);
        setResponseStarted(false);

        let fullResponse = "";

        // if there's exactly one pending edit, pass it to the backend so it
        // uses the accumulated content as the working base for section extraction
        const pendingList = Object.values(pendingEdits);
        const pendingFile: PendingFile | undefined =
            pendingList.length === 1
                ? { path: pendingList[0].path, content: pendingList[0].current, scope: pendingList[0].scope }
                : undefined;

        await sendChat(augmentedInput, scopes, history, (token) => {
            if (!responseStarted) setResponseStarted(true);
            fullResponse += token;
            setHistory([
                ...newHistory,
                { role: "assistant", content: fullResponse },
            ]);
        }, pendingFile);

        setStreaming(false);

        const { display, sentinel } = parseSentinel(fullResponse);

        const assistantMsg: AssistantMessage = {
            role: "assistant",
            content: display,
            sentinel: sentinel ?? undefined,
            prose: display,
        };

        setHistory([...newHistory, assistantMsg]);

        if (sentinel?.type === "file_edit") {
            setPendingEdits((prev) => {
                const existing = prev[sentinel.path];
                return {
                    ...prev,
                    [sentinel.path]: {
                        scope: sentinel.scope,
                        path: sentinel.path,
                        // preserve original disk content from first edit
                        original: existing?.original ?? sentinel.original,
                        current: sentinel.new,
                    },
                };
            });
            setActiveDiffPath(sentinel.path);
        }
    }

    async function resolveAmbiguous(
        candidate: { scope: string; path: string },
        newContent: string
    ) {
        let original = "";
        try {
            const result = await fetchFile(candidate.scope, candidate.path);
            original = result.content;
        } catch {
            // new file
        }
        setPendingEdits((prev) => ({
            ...prev,
            [candidate.path]: {
                scope: candidate.scope,
                path: candidate.path,
                original,
                current: newContent,
            },
        }));
        setActiveDiffPath(candidate.path);
    }

    async function handleApply(path: string) {
        const pe = pendingEdits[path];
        if (!pe) return;

        setApplying((prev) => ({ ...prev, [path]: true }));
        try {
            await applyEdit(pe.scope, pe.path, pe.current);
            setApplied((prev) => ({ ...prev, [path]: true }));
            // remove from pending after apply
            setPendingEdits((prev) => {
                const next = { ...prev };
                delete next[path];
                return next;
            });
            setActiveDiffPath(null);
        } catch (e) {
            console.error("apply failed", e);
        } finally {
            setApplying((prev) => ({ ...prev, [path]: false }));
        }
    }

    function handleKeyDown(e: React.KeyboardEvent) {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
        }
    }

    function renderAssistantContent(msg: ChatMessage, isStreaming: boolean) {
        const content = msg.content;
        const sentinel = (msg as AssistantMessage).sentinel;

        if (isStreaming) {
            const editMarkerIdx = content.indexOf("__EDIT_FILE__");
            const visible = editMarkerIdx !== -1
                ? content.slice(0, editMarkerIdx).trim()
                : content;
            return <pre className="content streaming">{visible}</pre>;
        }

        if (sentinel?.type === "file_edit") {
            const filename = sentinel.path.split("/").pop() ?? sentinel.path;
            const isApplied = applied[sentinel.path];
            const pe = pendingEdits[sentinel.path];
            return (
                <div className="content">
                    {(msg as AssistantMessage).prose && (
                        <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                            {(msg as AssistantMessage).prose!}
                        </ReactMarkdown>
                    )}
                    <div className="file-edit-pill-row">
                        <div
                            className={`file-edit-pill ${isApplied ? "applied" : ""}`}
                            onClick={() => !isApplied && setActiveDiffPath(sentinel.path)}
                        >
                            <span className="file-edit-pill-icon">
                                {isApplied ? "✓" : "✎"}
                            </span>
                            <span className="file-edit-pill-name">{filename}</span>
                            {!isApplied && (
                                <span className="file-edit-pill-action">view diff →</span>
                            )}
                            {isApplied && (
                                <span className="file-edit-pill-action">applied</span>
                            )}
                        </div>
                        {!isApplied && pe && (
                            <button
                                className="apply-btn"
                                onClick={() => handleApply(sentinel.path)}
                                disabled={applying[sentinel.path]}
                            >
                                {applying[sentinel.path] ? "applying…" : "apply"}
                            </button>
                        )}
                    </div>
                </div>
            );
        }

        if (sentinel?.type === "file_edit_ambiguous") {
            return (
                <div className="content">
                    {(msg as AssistantMessage).prose && (
                        <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                            {(msg as AssistantMessage).prose!}
                        </ReactMarkdown>
                    )}
                    <div className="file-picker">
                        <span className="file-picker-label">
                            Which file did you mean?
                        </span>
                        {sentinel.candidates.map((c) => (
                            <button
                                key={c.path}
                                className="file-picker-option"
                                onClick={() => resolveAmbiguous(c, sentinel.new)}
                            >
                                <span className="file-picker-scope">{c.scope}</span>
                                <span className="file-picker-path">{c.path}</span>
                            </button>
                        ))}
                    </div>
                </div>
            );
        }

        return (
            <div className="content">
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                    {content}
                </ReactMarkdown>
            </div>
        );
    }

    const activePendingEdit = activeDiffPath ? pendingEdits[activeDiffPath] : null;

    return (
        <div className="chat-layout">
            <div className="chat-panel">
                <div className="messages">
                    {history.map((msg, i) => (
                        <div key={i} className={`message ${msg.role}`}>
                            <span className="role-label">{msg.role}</span>
                            {msg.role === "assistant"
                                ? renderAssistantContent(
                                      msg,
                                      streaming && i === history.length - 1
                                  )
                                : <pre className="content">{msg.content}</pre>
                            }
                        </div>
                    ))}
                    {streaming && !responseStarted && (
                        <div className="typing-indicator">
                            <span style={{ whiteSpace: "pre", fontFamily: "monospace" }}>
                                {spinner.frames[spinnerFrame]}
                            </span>
                        </div>
                    )}
                    <div ref={bottomRef} />
                </div>
                <div className="input-row">
                    <textarea
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="Ask something... (Enter to send, Shift+Enter for newline)"
                        rows={3}
                        disabled={streaming}
                    />
                    <button onClick={submit} disabled={streaming || !input.trim()}>
                        {streaming ? "..." : "Send"}
                    </button>
                </div>
            </div>

            {activePendingEdit && (
                <DiffPanel
                    path={activePendingEdit.path}
                    originalContent={activePendingEdit.original}
                    newContent={activePendingEdit.current}
                    onClose={() => setActiveDiffPath(null)}
                    onApply={() => handleApply(activePendingEdit.path)}
                    applying={applying[activePendingEdit.path] ?? false}
                    applied={applied[activePendingEdit.path] ?? false}
                />
            )}
        </div>
    );
}
