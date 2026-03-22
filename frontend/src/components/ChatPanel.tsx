import { useState, useRef, useEffect } from "react";
import { type Message, sendChat, fetchFile } from "../api";
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

// ── file edit detection ────────────────────────────────────────────────────────

const FILE_EXTENSIONS = [
    "py", "ts", "tsx", "js", "jsx", "json", "yaml", "yml",
    "toml", "txt", "md", "sh", "rs", "go", "java", "c", "cpp", "h",
];

interface FileEdit {
    path: string;
    newContent: string;
}

function extractFileEdit(content: string): FileEdit | null {
    const extPattern = FILE_EXTENSIONS.join("|");
    const pattern = new RegExp(
        "(?:^|\\n)[^\\n]*?`?([\\w./\\- ]+\\.(?:" + extPattern + "))`?" +
        "[^\\n]*(?:\\n[^\\n]*){0,3}?" +
        "\\n```(?:\\w+)?\\n" +
        "([\\s\\S]*?)" +
        "\\n```",
        "g"
    );

    let match: RegExpExecArray | null;
    let last: FileEdit | null = null;
    while ((match = pattern.exec(content)) !== null) {
        last = { path: match[1].trim(), newContent: match[2] };
    }
    return last;
}

// ── diff state ─────────────────────────────────────────────────────────────────

interface DiffState {
    path: string;
    originalContent: string;
    newContent: string;
}

// ── component ──────────────────────────────────────────────────────────────────

export function ChatPanel({ scopes }: Props) {
    const [history, setHistory] = useState<Message[]>([]);
    const [input, setInput] = useState("");
    const [streaming, setStreaming] = useState(false);
    const [responseStarted, setResponseStarted] = useState(false);
    const [diffState, setDiffState] = useState<DiffState | null>(null);
    const [fileEdits, setFileEdits] = useState<Record<number, FileEdit>>({});

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

        const userMessage: Message = { role: "user", content: input };
        const newHistory = [...history, userMessage];
        const assistantIndex = newHistory.length;
        setHistory([...newHistory, { role: "assistant", content: "" }]);
        setInput("");
        setStreaming(true);
        setResponseStarted(false);

        let fullResponse = "";

        await sendChat(input, scopes, history, (token) => {
            if (!responseStarted) setResponseStarted(true);
            fullResponse += token;
            setHistory([...newHistory, { role: "assistant", content: fullResponse }]);
        });

        setStreaming(false);

        const edit = extractFileEdit(fullResponse);
        if (edit) {
            setFileEdits((prev) => ({ ...prev, [assistantIndex]: edit }));
        }
    }

    async function openDiff(edit: FileEdit) {
        for (const scope of scopes) {
            try {
                const result = await fetchFile(scope, edit.path);
                setDiffState({
                    path: edit.path,
                    originalContent: result.content,
                    newContent: edit.newContent,
                });
                return;
            } catch {
                // not in this scope, try next
            }
        }
        // new file — no original
        setDiffState({
            path: edit.path,
            originalContent: "",
            newContent: edit.newContent,
        });
    }

    function handleKeyDown(e: React.KeyboardEvent) {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
        }
    }

    return (
        <div className="chat-layout">
            <div className="chat-panel">
                <div className="messages">
                    {history.map((msg, i) => (
                        <div key={i} className={`message ${msg.role}`}>
                            <span className="role-label">{msg.role}</span>
                            {msg.role === "assistant" ? (
                                streaming && i === history.length - 1 ? (
                                    <pre className="content streaming">{msg.content}</pre>
                                ) : (
                                    <div className="content">
                                        <ReactMarkdown
                                            remarkPlugins={[remarkGfm]}
                                            components={mdComponents}
                                        >
                                            {msg.content}
                                        </ReactMarkdown>
                                        {fileEdits[i] && (
                                            <button
                                                className="diff-btn"
                                                onClick={() => openDiff(fileEdits[i])}
                                            >
                                                ⊕ view diff
                                            </button>
                                        )}
                                    </div>
                                )
                            ) : (
                                <pre className="content">{msg.content}</pre>
                            )}
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

            {diffState && (
                <DiffPanel
                    path={diffState.path}
                    originalContent={diffState.originalContent}
                    newContent={diffState.newContent}
                    onClose={() => setDiffState(null)}
                />
            )}
        </div>
    );
}
