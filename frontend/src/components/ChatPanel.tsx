import { useState, useRef, useEffect } from "react";
import { type Message, sendChat, fetchFile, applyEdit, type PendingFile } from "../api";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import cliSpinners from "cli-spinners";
import { DiffPanel } from "./DiffPanel";
import { MultiFileDiffPanel } from "./MultiFileDiffPanel";

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

interface MultiFileEditSentinel {
    type: "multi_file_edit";
    files: Array<{
        scope: string;
        path: string;
        original: string;
        new: string;
    }>;
}

type Sentinel = FileEditSentinel | FileEditAmbiguousSentinel | MultiFileEditSentinel;

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
const MULTI_SENTINEL_PREFIX = "__SHRIMP_MULTI_EDIT__";

function parseSentinel(content: string): {
    display: string;
    sentinel: Sentinel | null;
} {
    // Check for multi-file sentinel first
    let idx = content.indexOf(MULTI_SENTINEL_PREFIX);
    let prefix = MULTI_SENTINEL_PREFIX;

    // Fall back to single-file sentinel
    if (idx === -1) {
        idx = content.indexOf(SENTINEL_PREFIX);
        prefix = SENTINEL_PREFIX;
    }

    if (idx === -1) return { display: content, sentinel: null };

    const display = content.slice(0, idx).trim();
    const raw = content.slice(idx + prefix.length);

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

// ── stage labels ────────────────────────────────────────────────────────────

const STAGE_LABELS: Record<string, string> = {
    detecting: "Detecting intent…",
    finding: "Finding file…",
    reading: "Reading file…",
    thinking: "Thinking…",
    searching: "Searching…",
    done: "Applying…",
};

export function ChatPanel({ scopes }: Props) {
    const [history, setHistory] = useState<ChatMessage[]>([]);
    const [input, setInput] = useState("");
    const [streaming, setStreaming] = useState(false);
    const [responseStarted, setResponseStarted] = useState(false);
    const [stage, setStage] = useState<string>("");

    // per-file pending edits keyed by path
    const [pendingEdits, setPendingEdits] = useState<Record<string, PendingEdit>>({});

    // which file is currently shown in the diff panel (null = closed)
    const [activeDiffPath, setActiveDiffPath] = useState<string | null>(null);

    // apply state per file
    const [applying, setApplying] = useState<Record<string, boolean>>({});
    const [applied, setApplied] = useState<Record<string, boolean>>({});
    const [discarded, setDiscarded] = useState<Record<string, boolean>>({});

    // multi-file edit state
    const [multiFileEdit, setMultiFileEdit] = useState<MultiFileEditSentinel | null>(null);
    const [multiFileApplying, setMultiFileApplying] = useState(false);

    const bottomRef = useRef<HTMLDivElement>(null);
    const abortRef = useRef<AbortController | null>(null);
    const stageBufferRef = useRef<string>("");
    const spinner = cliSpinners.bouncingBar;
    const [spinnerFrame, setSpinnerFrame] = useState(0);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [history]);

    useEffect(() => {
        // Run spinner when waiting for response to start, or during file edit streaming with stage
        const shouldSpin = streaming && (!responseStarted || (stage && stage !== "done"));
        if (shouldSpin) {
            const interval = setInterval(() => {
                setSpinnerFrame((prev) => (prev + 1) % spinner.frames.length);
            }, spinner.interval);
            return () => clearInterval(interval);
        }
    }, [streaming, responseStarted, stage, spinner.frames.length, spinner.interval]);

    useEffect(() => {
        if (!streaming) {
            requestAnimationFrame(() => setSpinnerFrame(0));
        }
    }, [streaming]);

    async function submit() {
        if (!input.trim() || streaming) return;

        const augmentedInput = input;
        const userMessage: Message = { role: "user", content: input };
        const newHistory = [...history, userMessage];

        setHistory([...newHistory, { role: "assistant", content: "" }]);
        setInput("");
        setStreaming(true);
        setResponseStarted(false);

        let fullResponse = "";

        const pendingList = Object.values(pendingEdits);
        const pendingFile: PendingFile | undefined =
            pendingList.length === 1
                ? { path: pendingList[0].path, content: pendingList[0].current, scope: pendingList[0].scope }
                : undefined;

        const controller = new AbortController();
        abortRef.current = controller;

        // Helper to flush displayable content
        const flushContent = (content: string) => {
            if (content) {
                if (!responseStarted) setResponseStarted(true);
                fullResponse += content;
                setHistory([
                    ...newHistory,
                    { role: "assistant", content: fullResponse },
                ]);
            }
        };

        // Possible partial prefixes of "__STAGE__" (in order of length, longest first)
        const STAGE_PREFIXES = [
            "__STAGE_",
            "__STAGE",
            "__STAG",
            "__STA",
            "__ST",
            "__S",
            "__",
            "_",
        ];

        try {
            await sendChat(augmentedInput, scopes, history, (token) => {
                // Buffer tokens to handle partial __STAGE__ tokens
                stageBufferRef.current += token;

                // Process buffer - may contain multiple stage tokens
                let buffer = stageBufferRef.current;

                // Keep extracting stage tokens until none remain
                let stageMatch;
                while ((stageMatch = buffer.match(/__STAGE__(\w+)/))) {
                    // Found a complete stage token - extract it
                    const key = stageMatch[1];
                    setStage(key);
                    // Flush content before the stage token
                    const beforeStage = buffer.slice(0, stageMatch.index);
                    flushContent(beforeStage);
                    // Continue with content after the stage token
                    buffer = buffer.slice(stageMatch.index! + stageMatch[0].length);
                }

                // Check if buffer ends with a potential partial stage token
                for (const prefix of STAGE_PREFIXES) {
                    if (buffer.endsWith(prefix)) {
                        // Hold the potential partial in buffer, flush the rest
                        flushContent(buffer.slice(0, -prefix.length));
                        stageBufferRef.current = prefix;
                        return;
                    }
                }

                // No partial stage token, flush entire buffer
                flushContent(buffer);
                stageBufferRef.current = "";
            }, pendingFile, controller.signal);

            // Flush any remaining buffer content after stream ends
            if (stageBufferRef.current) {
                fullResponse += stageBufferRef.current;
                stageBufferRef.current = "";
            }
        } catch (err: unknown) {
            if (err instanceof Error && err.name !== "AbortError") {
                console.error("sendChat error:", err);
            }
        } finally {
            abortRef.current = null;
            setStreaming(false);
            setStage("");
            stageBufferRef.current = "";
        }

        // if cancelled mid-stream, keep whatever was received as plain text
        if (controller.signal.aborted) {
            setHistory([
                ...newHistory,
                { role: "assistant", content: fullResponse || "_(cancelled)_" },
            ]);
            return;
        }

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
                        original: existing?.original ?? sentinel.original,
                        current: sentinel.new,
                    },
                };
            });
            setActiveDiffPath(sentinel.path);
        } else if (sentinel?.type === "multi_file_edit") {
            setMultiFileEdit(sentinel);
        }
    }

    function cancel() {
        abortRef.current?.abort();
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

    function handleDiscard(path: string) {
        setPendingEdits((prev) => {
            const next = { ...prev };
            delete next[path];
            return next;
        });
        setDiscarded((prev) => ({ ...prev, [path]: true }));
        setActiveDiffPath(null);
    }

    async function handleMultiFileApply(approvedPaths: string[]) {
        if (!multiFileEdit) return;

        setMultiFileApplying(true);

        // Apply each approved file sequentially
        for (const path of approvedPaths) {
            const fileData = multiFileEdit.files.find(f => f.path === path);
            if (!fileData) continue;

            setApplying((prev) => ({ ...prev, [path]: true }));
            try {
                await applyEdit(fileData.scope, fileData.path, fileData.new);
                setApplied((prev) => ({ ...prev, [path]: true }));
            } catch (e) {
                console.error(`Failed to apply ${path}:`, e);
            } finally {
                setApplying((prev) => ({ ...prev, [path]: false }));
            }
        }

        setMultiFileApplying(false);

        // Check if all files are either applied or rejected
        const allProcessed = multiFileEdit.files.every(
            f => applied[f.path] || approvedPaths.indexOf(f.path) === -1
        );

        if (allProcessed) {
            // Close the multi-file panel after a brief delay
            setTimeout(() => setMultiFileEdit(null), 1000);
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

            // During file edit streaming (content starts with "Expanding"), show stage indicator
            if (content.includes("Expanding") && stage) {
                return (
                    <div className="typing-indicator">
                        <span className="spinner">{spinner.frames[spinnerFrame]}</span>
                        <span className="stage-label">{STAGE_LABELS[stage] ?? "Thinking…"}</span>
                    </div>
                );
            }

            return <pre className="content streaming">{visible}</pre>;
        }

        if (sentinel?.type === "file_edit") {
            const filename = sentinel.path.split("/").pop() ?? sentinel.path;
            const isApplied = applied[sentinel.path];
            const isDiscarded = discarded[sentinel.path];
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
                            className={`file-edit-pill ${isApplied ? "applied" : ""} ${isDiscarded ? "discarded" : ""}`}
                            onClick={() => !isApplied && !isDiscarded && setActiveDiffPath(sentinel.path)}
                        >
                            <span className="file-edit-pill-icon">
                                {isApplied ? "✓" : isDiscarded ? "✕" : "✎"}
                            </span>
                            <span className="file-edit-pill-name">{filename}</span>
                            <span className="file-edit-pill-action">
                                {isApplied ? "applied" : isDiscarded ? "discarded" : "view diff →"}
                            </span>
                        </div>
                        {!isApplied && !isDiscarded && pe && (
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
                            <span className="spinner">{spinner.frames[spinnerFrame]}</span>
                            <span className="stage-label">{STAGE_LABELS[stage] ?? "Thinking…"}</span>
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
                    {streaming ? (
                        <button className="stop-btn" onClick={cancel}>
                            ■ stop
                        </button>
                    ) : (
                        <button onClick={submit} disabled={!input.trim()}>
                            Send
                        </button>
                    )}
                </div>
            </div>

            {activePendingEdit && (
                <DiffPanel
                    path={activePendingEdit.path}
                    originalContent={activePendingEdit.original}
                    newContent={activePendingEdit.current}
                    onClose={() => setActiveDiffPath(null)}
                    onApply={() => handleApply(activePendingEdit.path)}
                    onDiscard={() => handleDiscard(activePendingEdit.path)}
                    applying={applying[activePendingEdit.path] ?? false}
                    applied={applied[activePendingEdit.path] ?? false}
                />
            )}

            {multiFileEdit && (
                <MultiFileDiffPanel
                    files={multiFileEdit.files}
                    onClose={() => setMultiFileEdit(null)}
                    onApplyAll={handleMultiFileApply}
                    applying={multiFileApplying}
                    applied={applied}
                />
            )}
        </div>
    );
}
