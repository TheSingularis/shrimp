import { useState, useRef, useEffect } from "react";
import { type Message, sendChat, fetchFile, applyEdit, type PendingFile } from "../api";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import cliSpinners from "cli-spinners";
import { MultiFileDiffPanel } from "./MultiFileDiffPanel";
import { RefreshCw, Check, X, Edit3 } from "lucide-react";

interface Props {
    scopes: string[];
    messages: ChatMessage[];
    onMessagesChange: (messages: ChatMessage[]) => void;
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
                            borderRadius: 0,
                            fontSize: "0.95rem",
                            background: "var(--color-bg-elevated)",
                            border: "none",
                            padding: "1.25rem",
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

interface StageMarker {
    type: "content" | "tools";
    stage: string;
    count?: number;
    tools?: string[];
    details?: string[];
}

interface AssistantMessage extends Message {
    role: "assistant";
    sentinel?: Sentinel;
    prose?: string;
    stageHistory?: StageMarker[];
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
    // Check for multi-file sentinel
    let idx = content.indexOf(MULTI_SENTINEL_PREFIX);
    let prefix = MULTI_SENTINEL_PREFIX;
    let isSingleFile = false;

    // Fall back to single-file sentinel
    if (idx === -1) {
        idx = content.indexOf(SENTINEL_PREFIX);
        prefix = SENTINEL_PREFIX;
        isSingleFile = true;
    }

    if (idx === -1) return { display: content, sentinel: null };

    const display = content.slice(0, idx).trim();
    const raw = content.slice(idx + prefix.length);

    try {
        let sentinel = JSON.parse(raw) as Sentinel;

        // Normalize single-file to multi-file format for consistent handling
        if (isSingleFile && sentinel.type === "file_edit") {
            sentinel = {
                type: "multi_file_edit",
                files: [{
                    scope: sentinel.scope,
                    path: sentinel.path,
                    original: sentinel.original,
                    new: sentinel.new,
                }]
            } as MultiFileEditSentinel;
        }

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
    planning: "Planning changes…",
    done: "Done",
};

function getStageLabel(stage: string): string {
    // Handle dynamic stages like "editing_1_of_3", "reviewing_2_of_5", "refining_3_of_4"
    if (stage.startsWith("editing_")) {
        const match = stage.match(/editing_(\d+)_of_(\d+)/);
        if (match) {
            return `Editing file ${match[1]}/${match[2]}…`;
        }
    }
    if (stage.startsWith("reviewing_")) {
        const match = stage.match(/reviewing_(\d+)_of_(\d+)/);
        if (match) {
            return `Reviewing file ${match[1]}/${match[2]}…`;
        }
    }
    if (stage.startsWith("refining_")) {
        const match = stage.match(/refining_(\d+)_of_(\d+)/);
        if (match) {
            return `Refining file ${match[1]}/${match[2]}…`;
        }
    }
    return STAGE_LABELS[stage] ?? "Processing…";
}

// ── stage marker formatting ────────────────────────────────────────────────

function formatStageMarker(marker: StageMarker): string {
    if (marker.type !== "tools") return "";

    const baseLabel: Record<string, string> = {
        "read_file": "Read files",
        "search_files": "Searched files",
        "list_scope": "Listed files",
        "propose_file_edit": "Planned changes"
    };

    const label = baseLabel[marker.stage] || "Processed";

    // Add details if available
    if (marker.details && marker.details.length > 0) {
        // For file paths, show just the filename
        const formatted = marker.details.map(d => {
            // If it looks like a file path, extract just the filename
            if (d.includes("/")) {
                return d.split("/").pop() || d;
            }
            return d;
        }).join(", ");

        return `${label}: ${formatted}`;
    }

    // Fallback to count-based label
    if (marker.count && marker.count > 1) {
        return `${label} • ${marker.count} calls`;
    }
    return label;
}

// ── markdown completion helper ─────────────────────────────────────────────

function completeIncompleteMarkdown(text: string): string {
    // Temporarily close incomplete markdown elements during streaming
    // to prevent visual snaps when they complete

    let completed = text;

    // Close unclosed code fences (```)
    const codeFenceCount = (text.match(/```/g) || []).length;
    if (codeFenceCount % 2 === 1) {
        // Odd number of fences means one is unclosed
        completed += "\n```";
    }

    // Close unclosed inline code (`)
    // Only check the last line to avoid false positives in multi-line content
    const lines = text.split("\n");
    const lastLine = lines[lines.length - 1] || "";
    const backtickCount = (lastLine.match(/`/g) || []).length;
    if (backtickCount % 2 === 1) {
        completed += "`";
    }

    // Close unclosed bold (**)
    const boldCount = (text.match(/\*\*/g) || []).length;
    if (boldCount % 2 === 1) {
        completed += "**";
    }

    // Close unclosed italic (*)
    // Count single * that aren't part of **
    const singleStarMatches = text.match(/(?<!\*)\*(?!\*)/g) || [];
    if (singleStarMatches.length % 2 === 1) {
        completed += "*";
    }

    return completed;
}

export function ChatPanel({ scopes, messages, onMessagesChange }: Props) {
    const [input, setInput] = useState("");
    const [streaming, setStreaming] = useState(false);
    const [responseStarted, setResponseStarted] = useState(false);
    const [stage, setStage] = useState<string>("");

    // per-file pending edits keyed by path
    const [pendingEdits, setPendingEdits] = useState<Record<string, PendingEdit>>({});

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
    const lastStageChangeRef = useRef<{ stage: string; timestamp: number }>({ stage: "", timestamp: 0 });
    const spinner = cliSpinners.bouncingBar;
    const [spinnerFrame, setSpinnerFrame] = useState(0);

    // Helper to update stage with minimum duration for important stages
    const updateStageWithMinDuration = (newStage: string) => {
        const now = Date.now();
        const { stage: currentStage, timestamp: lastChange } = lastStageChangeRef.current;
        const timeSinceChange = now - lastChange;
        const minDuration = 500; // 500ms

        // Important stages that should be visible for at least minDuration
        const stickyStages = ["reading", "searching", "finding", "planning"];

        // If current stage is sticky and hasn't been shown for min duration, ignore the change
        if (stickyStages.includes(currentStage) && timeSinceChange < minDuration) {
            return; // Ignore this stage change
        }

        // Apply the new stage
        setStage(newStage);
        lastStageChangeRef.current = { stage: newStage, timestamp: now };
    };

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

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
        const newHistory = [...messages, userMessage];

        onMessagesChange([...newHistory, { role: "assistant", content: "" }]);
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
                onMessagesChange([
                    ...newHistory,
                    { role: "assistant", content: fullResponse },
                ]);
            }
        };

        // Possible partial prefixes of "__STAGE__" and "__STAGE_MARKER__" (in order of length, longest first)
        const STAGE_PREFIXES = [
            "__STAGE_MARKER_",
            "__STAGE_MARKER",
            "__STAGE_MARKE",
            "__STAGE_MARK",
            "__STAGE_MAR",
            "__STAGE_MA",
            "__STAGE_M",
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
            await sendChat(augmentedInput, scopes, messages, (token) => {
                // Buffer tokens to handle partial __STAGE__ and __STAGE_MARKER__ tokens
                stageBufferRef.current += token;

                // Process buffer - may contain multiple stage tokens and markers
                let buffer = stageBufferRef.current;

                // Keep extracting __STAGE__ tokens (strip these for live indicators)
                let processed = true;
                while (processed) {
                    processed = false;

                    // Check for __STAGE__ tokens (strip these - they're for live indicators only)
                    const stageMatch = buffer.match(/__STAGE__(\w+)/);
                    if (stageMatch) {
                        processed = true;
                        const key = stageMatch[1];
                        updateStageWithMinDuration(key);
                        // Flush content before the stage token
                        const beforeStage = buffer.slice(0, stageMatch.index);
                        flushContent(beforeStage);
                        // Continue with content after the stage token (skip the token itself)
                        buffer = buffer.slice(stageMatch.index! + stageMatch[0].length);
                        continue;
                    }
                }

                // Keep __STAGE_MARKER__ tokens in the content - they'll be rendered inline

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
            onMessagesChange([
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

        onMessagesChange([...newHistory, assistantMsg]);

        // All file edits are now normalized to multi-file format (even single files)
        if (sentinel?.type === "multi_file_edit") {
            setMultiFileEdit(sentinel);

            // Also populate pendingEdits for follow-up request tracking
            setPendingEdits((prev) => {
                const next = { ...prev };
                for (const file of sentinel.files) {
                    const existing = prev[file.path];
                    next[file.path] = {
                        scope: file.scope,
                        path: file.path,
                        original: existing?.original ?? file.original,
                        current: file.new,
                    };
                }
                return next;
            });
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

        // Convert to multi-file format and show in unified diff editor
        setMultiFileEdit({
            type: "multi_file_edit",
            files: [{
                scope: candidate.scope,
                path: candidate.path,
                original,
                new: newContent,
            }]
        });
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

    async function handleRetry() {
        if (streaming) return;

        // Find the last user message
        const lastUserIndex = messages.findLastIndex(m => m.role === "user");
        if (lastUserIndex === -1) return;

        const lastUserMessage = messages[lastUserIndex];
        const userInput = lastUserMessage.content;

        // Remove the last assistant message to recreate history up to that point
        const historyWithoutLastAssistant = messages.slice(0, -1);

        // Re-add an empty assistant message for streaming
        onMessagesChange([...historyWithoutLastAssistant, { role: "assistant", content: "" }]);
        setStreaming(true);
        setResponseStarted(false);

        let fullResponse = "";
        const stageMarkers: StageMarker[] = []; // Track markers as they arrive

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
                onMessagesChange([
                    ...historyWithoutLastAssistant,
                    { role: "assistant", content: fullResponse, stageHistory: stageMarkers.length > 0 ? stageMarkers : undefined },
                ]);
            }
        };

        // Possible partial prefixes of "__STAGE__" and "__STAGE_MARKER__" (in order of length, longest first)
        const STAGE_PREFIXES = [
            "__STAGE_MARKER_",
            "__STAGE_MARKER",
            "__STAGE_MARKE",
            "__STAGE_MARK",
            "__STAGE_MAR",
            "__STAGE_MA",
            "__STAGE_M",
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
            // Pass history before the last user message (same as submit logic)
            await sendChat(userInput, scopes, historyWithoutLastAssistant.slice(0, -1), (token) => {
                // Buffer tokens to handle partial __STAGE__ and __STAGE_MARKER__ tokens
                stageBufferRef.current += token;

                // Process buffer - may contain multiple stage tokens and markers
                let buffer = stageBufferRef.current;

                // Keep extracting __STAGE__ tokens (strip these for live indicators)
                let processed = true;
                while (processed) {
                    processed = false;

                    // Check for __STAGE__ tokens (strip these - they're for live indicators only)
                    const stageMatch = buffer.match(/__STAGE__(\w+)/);
                    if (stageMatch) {
                        processed = true;
                        const key = stageMatch[1];
                        updateStageWithMinDuration(key);
                        // Flush content before the stage token
                        const beforeStage = buffer.slice(0, stageMatch.index);
                        flushContent(beforeStage);
                        // Continue with content after the stage token (skip the token itself)
                        buffer = buffer.slice(stageMatch.index! + stageMatch[0].length);
                        continue;
                    }
                }

                // Keep __STAGE_MARKER__ tokens in the content - they'll be rendered inline

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
            onMessagesChange([
                ...historyWithoutLastAssistant,
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

        onMessagesChange([...historyWithoutLastAssistant, assistantMsg]);

        // All file edits are now normalized to multi-file format (even single files)
        if (sentinel?.type === "multi_file_edit") {
            setMultiFileEdit(sentinel);

            // Also populate pendingEdits for follow-up request tracking
            setPendingEdits((prev) => {
                const next = { ...prev };
                for (const file of sentinel.files) {
                    const existing = prev[file.path];
                    next[file.path] = {
                        scope: file.scope,
                        path: file.path,
                        original: existing?.original ?? file.original,
                        current: file.new,
                    };
                }
                return next;
            });
        }
    }

    function handleKeyDown(e: React.KeyboardEvent) {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
        }
    }

    // Clean up tool call artifacts from content
    function cleanToolCallArtifacts(text: string): string {
        return text
            // Remove <tool_call> XML tags and their content
            .replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '')
            // Remove standalone JSON tool calls like {"name": "read_file", "arguments": {...}}
            .replace(/\{\s*"name"\s*:\s*"[^"]+"\s*,\s*"arguments"\s*:\s*\{[^}]*\}\s*\}/g, '')
            // Remove corrupted text patterns like "iNdEx"
            .replace(/\biNdEx\b/g, '')
            // Clean up extra whitespace left behind
            .replace(/\n\s*\n\s*\n/g, '\n\n')
            .trim();
    }

    function renderAssistantContent(msg: ChatMessage, isStreaming: boolean) {
        const content = cleanToolCallArtifacts(msg.content);
        const sentinel = (msg as AssistantMessage).sentinel;

        if (isStreaming) {
            const editMarkerIdx = content.indexOf("__EDIT_FILE__");
            const visible = editMarkerIdx !== -1
                ? content.slice(0, editMarkerIdx).trim()
                : content;

            // During file edit streaming (content starts with "Expanding"), show stage indicator
            if (content.includes("Expanding") && stage) {
                return (
                    <div className="flex items-center gap-3 text-text-muted text-base">
                        <span className="animate-pulse" style={{ fontFamily: 'Consolas, Monaco, "Courier New", Courier, monospace', whiteSpace: 'pre', color: 'var(--theme-primary)' }}>{spinner.frames[spinnerFrame]}</span>
                        <span className="font-medium">{getStageLabel(stage)}</span>
                    </div>
                );
            }

            // Parse inline markers even during streaming
            const markerRegex = /__STAGE_MARKER__(\{[^}]*\})/g;
            const parts: JSX.Element[] = [];
            let lastIndex = 0;
            let match;
            let markerIndex = 0;

            while ((match = markerRegex.exec(visible)) !== null) {
                // Add content before this marker
                if (match.index > lastIndex) {
                    const textBefore = visible.slice(lastIndex, match.index);
                    const completedMarkdown = completeIncompleteMarkdown(textBefore);
                    parts.push(
                        <ReactMarkdown key={`content-${markerIndex}`} remarkPlugins={[remarkGfm]} components={mdComponents}>
                            {completedMarkdown}
                        </ReactMarkdown>
                    );
                }

                // Parse and add the marker
                try {
                    const marker = JSON.parse(match[1]) as StageMarker;
                    const label = formatStageMarker(marker);
                    if (label) {
                        parts.push(
                            <div key={`marker-${markerIndex}`} className="stage-marker">
                                [{label}]
                            </div>
                        );
                    }
                } catch (e) {
                    // Ignore incomplete markers during streaming
                }

                lastIndex = match.index + match[0].length;
                markerIndex++;
            }

            // Add remaining content after last marker
            if (lastIndex < visible.length) {
                const textAfter = visible.slice(lastIndex);
                const completedMarkdown = completeIncompleteMarkdown(textAfter);
                parts.push(
                    <ReactMarkdown key={`content-${markerIndex}`} remarkPlugins={[remarkGfm]} components={mdComponents}>
                        {completedMarkdown}
                    </ReactMarkdown>
                );
            }

            // If no markers were found, render normally
            if (parts.length === 0) {
                const completedMarkdown = completeIncompleteMarkdown(visible);
                return (
                    <div className="content streaming">
                        <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                            {completedMarkdown}
                        </ReactMarkdown>
                    </div>
                );
            }

            return <div className="content streaming">{parts}</div>;
        }

        if (sentinel?.type === "multi_file_edit") {
            return (
                <div className="content">
                    {(msg as AssistantMessage).prose && (
                        <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                            {(msg as AssistantMessage).prose!}
                        </ReactMarkdown>
                    )}
                    <div className="file-edit-pill-row">
                        {sentinel.files.map((file) => {
                            const filename = file.path.split("/").pop() ?? file.path;
                            const isApplied = applied[file.path];
                            const isDiscarded = discarded[file.path];
                            const pe = pendingEdits[file.path];
                            return (
                                <div key={file.path} style={{ marginBottom: "0.5rem" }}>
                                    <div
                                        className={`file-edit-pill ${isApplied ? "applied" : ""} ${isDiscarded ? "discarded" : ""}`}
                                        onClick={() => {
                                            if (!isApplied && !isDiscarded) {
                                                // Re-open the multi-file editor with just this file visible
                                                setMultiFileEdit(sentinel);
                                            }
                                        }}
                                    >
                                        <span className="file-edit-pill-icon">
                                            {isApplied ? <Check size={14} /> : isDiscarded ? <X size={14} /> : <Edit3 size={14} />}
                                        </span>
                                        <span className="file-edit-pill-name">{filename}</span>
                                        <span className="file-edit-pill-action">
                                            {isApplied ? "applied" : isDiscarded ? "discarded" : "view diff →"}
                                        </span>
                                    </div>
                                    {!isApplied && !isDiscarded && pe && (
                                        <button
                                            className="apply-btn"
                                            onClick={() => handleApply(file.path)}
                                            disabled={applying[file.path]}
                                        >
                                            {applying[file.path] ? "applying…" : "apply"}
                                        </button>
                                    )}
                                </div>
                            );
                        })}
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

        // Parse and render inline stage markers
        // Updated regex to handle JSON with nested objects (non-greedy)
        const markerRegex = /__STAGE_MARKER__(\{.*?\}(?=\s|$|__STAGE_MARKER__|[^\{]))/g;
        const parts: JSX.Element[] = [];
        let lastIndex = 0;
        let match;
        let markerIndex = 0;

        while ((match = markerRegex.exec(content)) !== null) {
            // Add content before this marker
            if (match.index > lastIndex) {
                let textBefore = content.slice(lastIndex, match.index);
                // Clean up any trailing artifacts like ", {" or "]}]}" from split JSON
                textBefore = textBefore.replace(/,\s*\{\s*$/, '').replace(/\]\}\]\}\s*$/, '').trim();
                if (textBefore) {
                    parts.push(
                        <ReactMarkdown key={`content-${markerIndex}`} remarkPlugins={[remarkGfm]} components={mdComponents}>
                            {textBefore}
                        </ReactMarkdown>
                    );
                }
            }

            // Parse and add the marker
            try {
                const marker = JSON.parse(match[1]) as StageMarker;
                const label = formatStageMarker(marker);
                if (label) {
                    parts.push(
                        <div key={`marker-${markerIndex}`} className="stage-marker">
                            [{label}]
                        </div>
                    );
                }
            } catch (e) {
                console.error("Failed to parse stage marker:", e);
            }

            lastIndex = match.index + match[0].length;
            markerIndex++;
        }

        // Add remaining content after last marker
        if (lastIndex < content.length) {
            let textAfter = content.slice(lastIndex);
            // Clean up any leading artifacts like "]}" or ", {" from split JSON
            textAfter = textAfter.replace(/^\s*,\s*\{/, '').replace(/^\s*\]\}/, '').trim();
            if (textAfter) {
                parts.push(
                    <ReactMarkdown key={`content-${markerIndex}`} remarkPlugins={[remarkGfm]} components={mdComponents}>
                        {textAfter}
                    </ReactMarkdown>
                );
            }
        }

        // If no markers were found, just render the content normally
        if (parts.length === 0) {
            return (
                <div className="content">
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                        {content}
                    </ReactMarkdown>
                </div>
            );
        }

        return <div className="content">{parts}</div>;
    }

    return (
        <div className="flex h-full bg-bg-dark">
            {/* Chat Panel - Modern Blue/Purple Design */}
            <div className="flex flex-col flex-1 h-full">
                {/* Messages Area */}
                <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden py-8 space-y-12">
                    <div className="max-w-6xl mx-auto px-6 md:px-8">
                        {/* Welcome Screen */}
                        {messages.length === 0 && (
                            <div className="flex flex-col items-center justify-center min-h-[60vh] text-center opacity-70">
                                <img
                                    src="/icons/shrimp(1).png"
                                    alt="SHRIMP"
                                    className="w-32 h-32 mb-8"
                                />
                                <h1 className="text-3xl font-semibold mb-2">
                                    Welcome to SHRIMP<span style={{ color: 'var(--theme-primary)' }}>*</span>
                                </h1>
                                <p className="text-lg mb-2">Self-Hosted RAG Intelligence Model Project</p>
                                <p className="text-text-muted max-w-md mt-4">
                                    Ask me about your indexed files, and I'll help you find what you need.
                                </p>
                            </div>
                        )}

                        {messages.map((msg, i) => {
                            const isLastAssistant = msg.role === "assistant" && i === messages.length - 1;
                            const isUser = msg.role === "user";

                            return (
                                <div key={i} className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} ${i > 0 ? 'mt-12' : ''}`}>
                                    {/* Role Label */}
                                    <div className="flex items-center gap-3 mb-3">
                                        <span
                                            className="text-base font-medium capitalize"
                                            style={{ color: isUser ? 'var(--theme-primary)' : 'var(--color-text)' }}
                                        >
                                            {msg.role === 'user' ? 'You' : 'Assistant'}
                                        </span>
                                    </div>

                                    {/* Message Content */}
                                    {isUser ? (
                                        <div className="max-w-3xl">
                                            <div className="border-r-2 pr-8 pl-6 bg-bg-elevated/40 rounded-l-lg py-3" style={{ borderColor: 'var(--theme-primary)' }}>
                                                <pre className="text-base whitespace-pre-wrap break-words text-text">{msg.content}</pre>
                                            </div>
                                        </div>
                                    ) : (
                                        <>
                                            <div className="max-w-3xl">
                                                <div className="border-l-2 pl-8 pr-6" style={{ borderColor: 'var(--theme-primary)' }}>
                                                    {renderAssistantContent(msg, streaming && i === messages.length - 1)}
                                                </div>
                                            </div>
                                            {/* Retry button - only on last assistant message */}
                                            {isLastAssistant && !streaming && (
                                                <button
                                                    onClick={handleRetry}
                                                    title="Regenerate response"
                                                    className="retry-button !px-3 !py-0 mt-3 ml-8 h-8 w-8 min-h-8 min-w-8 flex items-center justify-center transition-colors rounded hover:bg-bg-elevated/50"
                                                    style={{ color: 'var(--color-text-muted)' }}
                                                >
                                                    <RefreshCw size={16} strokeWidth={2} className="shrink-0" />
                                                </button>
                                            )}
                                        </>
                                    )}
                                </div>
                            );
                        })}

                        {/* Typing Indicator */}
                        {streaming && !responseStarted && (
                            <div className="flex items-center gap-3 text-text-muted text-base mt-4">
                                <span className="animate-pulse" style={{ fontFamily: 'Consolas, Monaco, "Courier New", Courier, monospace', whiteSpace: 'pre', color: 'var(--theme-primary)' }}>{spinner.frames[spinnerFrame]}</span>
                                <span className="font-medium">{getStageLabel(stage)}</span>
                            </div>
                        )}

                        <div ref={bottomRef} />
                    </div>
                </div>

                {/* Input Area - Sticky Bottom */}
                <div className="shrink-0 border-t border-border bg-bg-dark/95 backdrop-blur-md">
                    <div className="py-2 px-6">
                        <div className="flex gap-3 items-center max-w-3xl mx-auto">
                            <textarea
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                onKeyDown={handleKeyDown}
                                placeholder="Ask anything..."
                                rows={1}
                                disabled={streaming}
                                className="chat-input flex-1 resize-none rounded-2xl bg-bg-elevated border border-border px-6 py-3.5 text-base
                                           focus:outline-none focus:ring-2 focus:shadow-md
                                           disabled:opacity-50 disabled:cursor-not-allowed placeholder:text-text-muted
                                           transition-shadow duration-200 shadow-sm leading-normal min-h-[52px]"
                            />
                            {streaming ? (
                                <button
                                    onClick={cancel}
                                    className="shrink-0 h-[52px] px-6 rounded-full bg-red-500/10 hover:bg-red-500/20 border border-red-500/30
                                               text-red-400 font-medium transition-all flex items-center justify-center"
                                >
                                    Stop
                                </button>
                            ) : (
                                <button
                                    onClick={submit}
                                    disabled={!input.trim()}
                                    className="shrink-0 h-[52px] px-8 rounded-full bg-gradient-to-r from-blue-primary to-purple-accent
                                               hover:from-blue-hover hover:to-purple-accent text-white font-semibold
                                               transition-all disabled:opacity-30 disabled:cursor-not-allowed
                                               shadow-lg hover:shadow-xl hover:scale-105 active:scale-95
                                               flex items-center justify-center"
                                >
                                    Send
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Multi-File Diff Panel */}
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
