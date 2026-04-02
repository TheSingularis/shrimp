import { useState, useRef, useEffect } from "react";
import { type Message, sendChat, fetchFile, applyEdit, type PendingFile } from "../api";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import cliSpinners from "cli-spinners";
import { lazy, Suspense, startTransition } from "react";
import { RefreshCw, Check, X, Edit3 } from "lucide-react";

// Lazy load Monaco-based diff panel to reduce initial bundle and defer heavy initialization
const MultiFileDiffPanel = lazy(() => import("./MultiFileDiffPanel").then(module => ({ default: module.MultiFileDiffPanel })));

interface Props {
    scopes: string[];
    messages: ChatMessage[];
    onMessagesChange: (messages: ChatMessage[]) => void;
    conversationId: string | null;
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

// ── stage marker cleanup ───────────────────────────────────────────────────────

/**
 * Strip all __STAGE_MARKER__ tokens from text.
 * Uses brace counting to handle nested JSON properly.
 */
function stripStageMarkers(text: string): string {
    let cleaned = text;
    while (cleaned.includes("__STAGE_MARKER__")) {
        const idx = cleaned.indexOf("__STAGE_MARKER__");
        const jsonStart = idx + "__STAGE_MARKER__".length;

        // Find matching closing brace
        let braceCount = 0;
        let inString = false;
        let escaped = false;
        let jsonEnd = -1;

        for (let i = jsonStart; i < cleaned.length; i++) {
            const char = cleaned[i];
            if (escaped) { escaped = false; continue; }
            if (char === '\\') { escaped = true; continue; }
            if (char === '"') { inString = !inString; continue; }
            if (inString) continue;
            if (char === '{') braceCount++;
            else if (char === '}') {
                braceCount--;
                if (braceCount === 0) {
                    jsonEnd = i + 1;
                    break;
                }
            }
        }

        // Remove the marker (or remove up to end if malformed)
        if (jsonEnd !== -1) {
            cleaned = cleaned.slice(0, idx) + cleaned.slice(jsonEnd);
        } else {
            // Malformed - just remove the prefix and everything after
            console.warn("[Stage Marker] Malformed marker, truncating:", cleaned.slice(idx, idx + 100));
            cleaned = cleaned.slice(0, idx);
        }
    }
    return cleaned;
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
    finding_: "Finding file…",
    reading: "Reading file…",
    reading_: "Reading file…",
    thinking: "Thinking…",
    searching: "Searching…",
    searching_: "Searching…",
    planning: "Planning changes…",
    planning_: "Planning changes…",
    editing_: "Editing…",
    reviewing_: "Reviewing…",
    refining_: "Refining…",
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

export function ChatPanel({ scopes, messages, onMessagesChange, conversationId }: Props) {
    const [input, setInput] = useState("");
    const [streaming, setStreaming] = useState(false);
    const [responseStarted, setResponseStarted] = useState(false);
    const [stage, setStage] = useState<string>("");
    const [renderKey, setRenderKey] = useState(0); // Force re-render when streaming stops

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
    const markerHoldCountRef = useRef<number>(0); // Track how long we've held a partial marker
    const spinner = cliSpinners.bouncingBar;
    const [spinnerFrame, setSpinnerFrame] = useState(0);

    // Update stage immediately when tokens arrive
    const updateStage = (newStage: string) => {
        console.log(`[Spinner] Stage changed: "${stage}" → "${newStage}"`);
        setStage(newStage);
    };

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    useEffect(() => {
        // Run spinner when waiting for response to start, or during file edit streaming with stage
        const shouldSpin = streaming && (!responseStarted || (stage && stage !== "done"));

        console.log(`[Spinner] State check: streaming=${streaming}, responseStarted=${responseStarted}, stage="${stage}", shouldSpin=${shouldSpin}`);

        if (shouldSpin) {
            console.log(`[Spinner] STARTING animation (stage: "${stage}")`);
            const interval = setInterval(() => {
                setSpinnerFrame((prev) => (prev + 1) % spinner.frames.length);
            }, spinner.interval);
            return () => {
                console.log(`[Spinner] STOPPING animation (stage: "${stage}")`);
                clearInterval(interval);
            };
        }
    }, [streaming, responseStarted, stage, spinner.frames.length, spinner.interval]);

    useEffect(() => {
        if (!streaming) {
            console.log(`[Spinner] Resetting frame to 0 (streaming stopped)`);
            requestAnimationFrame(() => setSpinnerFrame(0));
        }
    }, [streaming]);

    // Track visibility of typing indicator
    useEffect(() => {
        const showTypingIndicator = streaming && (!responseStarted || (stage && stage !== "done"));
        console.log(`[Spinner] Typing indicator visible: ${showTypingIndicator} (streaming=${streaming}, responseStarted=${responseStarted}, stage="${stage}")`);
    }, [streaming, responseStarted, stage]);

    async function submit() {
        if (!input.trim() || streaming) return;

        // Clear diff editor and edit states from previous response
        setMultiFileEdit(null);
        setPendingEdits({});
        setApplying({});
        setApplied({});
        setDiscarded({});

        const augmentedInput = input;
        const userMessage: Message = { role: "user", content: input };
        const newHistory = [...messages, userMessage];

        onMessagesChange([...newHistory, { role: "assistant", content: "" }]);
        setInput("");
        setStreaming(true);
        setResponseStarted(false);
        markerHoldCountRef.current = 0; // Reset marker hold counter

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
            "__STAGE_MARKER__",
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
                // Debug: Log every token received

                // Buffer tokens to handle partial __STAGE__ and __STAGE_MARKER__ tokens
                stageBufferRef.current += token;
                let buffer = stageBufferRef.current;

                // Steps 1-2: Loop until all __STAGE__ and __STAGE_MARKER__ tokens are processed
                let keepProcessing = true;
                while (keepProcessing) {
                    keepProcessing = false;

                    // Step 1: Extract and strip __STAGE__ tokens (for live spinner updates)
                    const stageMatch = buffer.match(/__STAGE__(?!MARKER)([a-z]+(?:_(?!_))?)/);
                    if (stageMatch) {
                        keepProcessing = true;
                        const key = stageMatch[1];
                        updateStage(key);
                        flushContent(buffer.slice(0, stageMatch.index));
                        buffer = buffer.slice(stageMatch.index! + stageMatch[0].length);
                        markerHoldCountRef.current = 0; // Reset hold counter
                        continue;
                    }

                    // Step 2: Extract and strip __STAGE_MARKER__ tokens (to prevent JSON artifacts)
                    if (buffer.includes("__STAGE_MARKER__")) {
                        keepProcessing = true;
                        const markerIdx = buffer.indexOf("__STAGE_MARKER__");
                        const jsonStart = markerIdx + "__STAGE_MARKER__".length;


                        // Find complete JSON by counting braces
                        let braceCount = 0;
                        let inString = false;
                        let escaped = false;
                        let jsonEnd = -1;

                        for (let i = jsonStart; i < buffer.length; i++) {
                            const char = buffer[i];
                            if (escaped) { escaped = false; continue; }
                            if (char === '\\') { escaped = true; continue; }
                            if (char === '"') { inString = !inString; continue; }
                            if (inString) continue;
                            if (char === '{') braceCount++;
                            else if (char === '}') {
                                braceCount--;
                                if (braceCount === 0) {
                                    jsonEnd = i + 1;
                                    break;
                                }
                            }
                        }

                        // If JSON incomplete, hold in buffer for next chunk
                        if (jsonEnd === -1) {
                            markerHoldCountRef.current++;

                            // Safety: if we've held this partial marker for too long, it's probably malformed
                            // Skip past the marker prefix and continue
                            if (markerHoldCountRef.current > 20) {
                                console.warn("[Stage Marker] Held partial marker for 20+ chunks, skipping:", buffer.slice(markerIdx, markerIdx + 50));
                                flushContent(buffer.slice(0, markerIdx));
                                buffer = buffer.slice(markerIdx + "__STAGE_MARKER__".length);
                                markerHoldCountRef.current = 0;
                                continue;
                            }

                            // Hold everything from the marker onward for next chunk
                            flushContent(buffer.slice(0, markerIdx));
                            stageBufferRef.current = buffer.slice(markerIdx);
                            return;
                        }

                        // Complete marker found - parse it and render as inline text
                        const markerJson = buffer.slice(jsonStart, jsonEnd);

                        markerHoldCountRef.current = 0;
                        flushContent(buffer.slice(0, markerIdx));

                        // Parse and render the marker as inline text
                        try {
                            const marker = JSON.parse(markerJson);
                            let markerText = "";
                            if (marker.type === "tools") {
                                const details = marker.details?.join(", ") || "";
                                markerText = `\n[${marker.stage.replace(/_/g, " ")}: ${details}]\n`;
                            } else {
                            }
                            flushContent(markerText);
                        } catch (e) {
                            // Don't flush the broken marker - it will be skipped
                        }

                        buffer = buffer.slice(jsonEnd);
                        continue;  // Loop back to check for more __STAGE__ or __STAGE_MARKER__ tokens
                    }
                }

                // Step 3: Check if buffer ends with partial token prefix
                for (const prefix of STAGE_PREFIXES) {
                    if (buffer.endsWith(prefix)) {
                        flushContent(buffer.slice(0, -prefix.length));
                        stageBufferRef.current = prefix;
                        return;
                    }
                }

                // Step 4: Flush remaining buffer
                flushContent(buffer);
                stageBufferRef.current = "";
                markerHoldCountRef.current = 0;
            }, pendingFile, conversationId, controller.signal);

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
            markerHoldCountRef.current = 0;
            // Force re-render to apply marker styling to final content
            setRenderKey(prev => prev + 1);
        }

        // if cancelled mid-stream, keep whatever was received as plain text
        if (controller.signal.aborted) {
            onMessagesChange([
                ...newHistory,
                { role: "assistant", content: fullResponse || "_(cancelled)_" },
            ]);
            return;
        }

        // Clean up any remaining __STAGE_MARKER__ tokens
        fullResponse = stripStageMarkers(fullResponse);

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
            // Use startTransition to mark diff panel mounting as non-urgent (prevents freezing)
            // Small delay ensures loading state is visible and main thread has time to render
            startTransition(() => {
                setTimeout(() => setMultiFileEdit(sentinel), 50);
            });

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

        // Clear diff editor and edit states from previous response
        setMultiFileEdit(null);
        setPendingEdits({});
        setApplying({});
        setApplied({});
        setDiscarded({});

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
        markerHoldCountRef.current = 0; // Reset marker hold counter

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
            "__STAGE_MARKER__",
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
                let buffer = stageBufferRef.current;

                // Steps 1-2: Loop until all __STAGE__ and __STAGE_MARKER__ tokens are processed
                let keepProcessing = true;
                while (keepProcessing) {
                    keepProcessing = false;

                    // Step 1: Extract and strip __STAGE__ tokens (for live spinner updates)
                    const stageMatch = buffer.match(/__STAGE__(?!MARKER)([a-z]+(?:_(?!_))?)/);
                    if (stageMatch) {
                        keepProcessing = true;
                        const key = stageMatch[1];
                        updateStage(key);
                        flushContent(buffer.slice(0, stageMatch.index));
                        buffer = buffer.slice(stageMatch.index! + stageMatch[0].length);
                        markerHoldCountRef.current = 0; // Reset hold counter
                        continue;
                    }

                    // Step 2: Extract and strip __STAGE_MARKER__ tokens (to prevent JSON artifacts)
                    if (buffer.includes("__STAGE_MARKER__")) {
                        keepProcessing = true;
                        const markerIdx = buffer.indexOf("__STAGE_MARKER__");
                        const jsonStart = markerIdx + "__STAGE_MARKER__".length;


                        // Find complete JSON by counting braces
                        let braceCount = 0;
                        let inString = false;
                        let escaped = false;
                        let jsonEnd = -1;

                        for (let i = jsonStart; i < buffer.length; i++) {
                            const char = buffer[i];
                            if (escaped) { escaped = false; continue; }
                            if (char === '\\') { escaped = true; continue; }
                            if (char === '"') { inString = !inString; continue; }
                            if (inString) continue;
                            if (char === '{') braceCount++;
                            else if (char === '}') {
                                braceCount--;
                                if (braceCount === 0) {
                                    jsonEnd = i + 1;
                                    break;
                                }
                            }
                        }

                        // If JSON incomplete, hold in buffer for next chunk
                        if (jsonEnd === -1) {
                            markerHoldCountRef.current++;

                            // Safety: if we've held this partial marker for too long, it's probably malformed
                            // Skip past the marker prefix and continue
                            if (markerHoldCountRef.current > 20) {
                                console.warn("[Stage Marker] Held partial marker for 20+ chunks, skipping:", buffer.slice(markerIdx, markerIdx + 50));
                                flushContent(buffer.slice(0, markerIdx));
                                buffer = buffer.slice(markerIdx + "__STAGE_MARKER__".length);
                                markerHoldCountRef.current = 0;
                                continue;
                            }

                            // Hold everything from the marker onward for next chunk
                            flushContent(buffer.slice(0, markerIdx));
                            stageBufferRef.current = buffer.slice(markerIdx);
                            return;
                        }

                        // Complete marker found - parse it and render as inline text
                        const markerJson = buffer.slice(jsonStart, jsonEnd);

                        markerHoldCountRef.current = 0;
                        flushContent(buffer.slice(0, markerIdx));

                        // Parse and render the marker as inline text
                        try {
                            const marker = JSON.parse(markerJson);
                            let markerText = "";
                            if (marker.type === "tools") {
                                const details = marker.details?.join(", ") || "";
                                markerText = `\n[${marker.stage.replace(/_/g, " ")}: ${details}]\n`;
                            } else {
                            }
                            flushContent(markerText);
                        } catch (e) {
                            // Don't flush the broken marker - it will be skipped
                        }

                        buffer = buffer.slice(jsonEnd);
                        continue;  // Loop back to check for more __STAGE__ or __STAGE_MARKER__ tokens
                    }
                }

                // Step 3: Check if buffer ends with partial token prefix
                for (const prefix of STAGE_PREFIXES) {
                    if (buffer.endsWith(prefix)) {
                        flushContent(buffer.slice(0, -prefix.length));
                        stageBufferRef.current = prefix;
                        return;
                    }
                }

                // Step 4: Flush remaining buffer
                flushContent(buffer);
                stageBufferRef.current = "";
                markerHoldCountRef.current = 0;
            }, pendingFile, conversationId, controller.signal);

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
            markerHoldCountRef.current = 0;
            // Force re-render to apply marker styling to final content
            setRenderKey(prev => prev + 1);
        }

        // if cancelled mid-stream, keep whatever was received as plain text
        if (controller.signal.aborted) {
            onMessagesChange([
                ...historyWithoutLastAssistant,
                { role: "assistant", content: fullResponse || "_(cancelled)_" },
            ]);
            return;
        }

        // Clean up any remaining __STAGE_MARKER__ tokens
        fullResponse = stripStageMarkers(fullResponse);

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
            // Use startTransition to mark diff panel mounting as non-urgent (prevents freezing)
            // Small delay ensures loading state is visible and main thread has time to render
            startTransition(() => {
                setTimeout(() => setMultiFileEdit(sentinel), 50);
            });

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

    /**
     * Extract stage markers from content using proper JSON parsing.
     * Handles nested arrays and objects correctly by counting braces.
     * Returns cleaned content and array of parsed markers.
     */
    function extractStageMarkers(text: string): { content: string; markers: StageMarker[] } {
        const markers: StageMarker[] = [];
        let cleaned = text;
        const markerPrefix = "__STAGE_MARKER__";

        let searchIndex = 0;
        while (true) {
            const markerIndex = cleaned.indexOf(markerPrefix, searchIndex);
            if (markerIndex === -1) break;

            const jsonStart = markerIndex + markerPrefix.length;

            // Find complete JSON by counting braces
            let braceCount = 0;
            let inString = false;
            let escaped = false;
            let jsonEnd = -1;

            for (let i = jsonStart; i < cleaned.length; i++) {
                const char = cleaned[i];

                if (escaped) {
                    escaped = false;
                    continue;
                }

                if (char === '\\') {
                    escaped = true;
                    continue;
                }

                if (char === '"') {
                    inString = !inString;
                    continue;
                }

                if (inString) continue;

                if (char === '{') {
                    braceCount++;
                } else if (char === '}') {
                    braceCount--;
                    if (braceCount === 0) {
                        jsonEnd = i + 1;
                        break;
                    }
                }
            }

            if (jsonEnd === -1) {
                // Incomplete JSON during streaming - keep remainder
                searchIndex = markerIndex + 1;
                continue;
            }

            // Extract and parse JSON
            const jsonStr = cleaned.slice(jsonStart, jsonEnd);
            try {
                const marker = JSON.parse(jsonStr) as StageMarker;
                markers.push(marker);

                // Remove marker from content
                cleaned = cleaned.slice(0, markerIndex) + cleaned.slice(jsonEnd);
                searchIndex = markerIndex;
            } catch (e) {
                console.error("[Stage Marker] Parse failed:", e, jsonStr);
                searchIndex = markerIndex + 1;
            }
        }

        return { content: cleaned, markers };
    }

    // Clean up tool call artifacts from content (but keep stage markers for rendering)
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
        // NOTE: __STAGE_MARKER__ tokens are NOT removed here - they're parsed during rendering
    }

    // Parse content and render tool markers with styling
    function renderContentWithMarkers(content: string, isStreaming: boolean) {
        // Match our tool marker format: [tool_name: details]
        // Capture the newline/start separately to preserve spacing
        const markerRegex = /(^|\n)\[([\w\s]+):\s*([^\]]+)\](?:\n|$)/gm;
        const parts: JSX.Element[] = [];
        let lastIndex = 0;
        let match;

        while ((match = markerRegex.exec(content)) !== null) {
            const leadingChar = match[1]; // Either '' (start of string) or '\n'
            const markerStartIdx = match.index + leadingChar.length; // Skip past the leading \n

            // Add text before the marker (including any leading newline from previous content)
            if (markerStartIdx > lastIndex) {
                const textBefore = content.slice(lastIndex, markerStartIdx);
                parts.push(
                    <ReactMarkdown key={`text-${lastIndex}`} remarkPlugins={[remarkGfm]} components={mdComponents}>
                        {textBefore}
                    </ReactMarkdown>
                );
            }

            // Add the styled marker
            const toolName = match[2];
            const details = match[3];
            parts.push(
                <div key={`marker-${match.index}`} className="stage-marker">
                    [{toolName}: {details}]
                </div>
            );

            lastIndex = markerRegex.lastIndex;
        }

        // Add remaining content after last marker
        if (lastIndex < content.length) {
            const remaining = content.slice(lastIndex);
            parts.push(
                <ReactMarkdown key={`text-${lastIndex}`} remarkPlugins={[remarkGfm]} components={mdComponents}>
                    {remaining}
                </ReactMarkdown>
            );
        }

        // Fallback: if no parts were created, render the raw content
        if (parts.length === 0) {
            return (
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                    {content}
                </ReactMarkdown>
            );
        }

        return <>{parts}</>;
    }

    function renderAssistantContent(msg: ChatMessage, isStreaming: boolean) {
        const content = cleanToolCallArtifacts(msg.content);
        const sentinel = (msg as AssistantMessage).sentinel;

        // Handle multi-file edits first (special UI)
        if (sentinel?.type === "multi_file_edit") {
            return (
                <div className="content">
                    {(msg as AssistantMessage).prose && renderContentWithMarkers((msg as AssistantMessage).prose!, false)}
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
                    {(msg as AssistantMessage).prose && renderContentWithMarkers((msg as AssistantMessage).prose!, false)}
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

        // Render all content (streaming or final) with unified marker styling
        // Hide edit markers during streaming
        const editMarkerIdx = content.indexOf("__EDIT_FILE__");
        const visible = editMarkerIdx !== -1 ? content.slice(0, editMarkerIdx).trim() : content;

        // Complete incomplete markdown only during streaming
        const processedContent = isStreaming ? completeIncompleteMarkdown(visible) : visible;

        return (
            <div className="content" key={`content-${isStreaming ? 'streaming' : 'final'}-${msg.content.length}-${renderKey}`}>
                {renderContentWithMarkers(processedContent, isStreaming)}
                {/* Hidden debug element - raw content for debugging styling/parsing issues */}
                <pre className="debug-raw-content" style={{ display: 'none' }} data-original-length={msg.content.length}>
                    {msg.content}
                </pre>
            </div>
        );
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
                                                    <RefreshCw size={16} strokeWidth={2} className="shrink-0" style={{ color: 'var(--accent)' }} />
                                                </button>
                                            )}
                                        </>
                                    )}
                                </div>
                            );
                        })}

                        {/* Typing Indicator */}
                        {streaming && (!responseStarted || (stage && stage !== "done")) && (
                            <>
                                {console.log(`[Spinner] RENDERING typing indicator: frame=${spinnerFrame}, stage="${stage}", label="${getStageLabel(stage)}"`)}
                                <div className="flex items-center gap-3 text-text-muted text-base mt-4">
                                    <span className="animate-pulse" style={{ fontFamily: 'Consolas, Monaco, "Courier New", Courier, monospace', whiteSpace: 'pre', color: 'var(--theme-primary)' }}>{spinner.frames[spinnerFrame]}</span>
                                    <span className="font-medium">{getStageLabel(stage)}</span>
                                </div>
                            </>
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
                                rows={2}
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

            {/* Multi-File Diff Panel - Lazy loaded to avoid blocking main thread */}
            {multiFileEdit && (
                <Suspense fallback={
                    <div className="multi-diff-panel" style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: 'var(--color-bg-elevated)',
                        border: '1px solid var(--color-border)',
                        borderRadius: '0.75rem',
                        padding: '3rem'
                    }}>
                        <div style={{ textAlign: 'center' }}>
                            <div style={{
                                fontSize: '1.5rem',
                                marginBottom: '1rem',
                                color: 'var(--theme-primary)'
                            }}>
                                {spinner.frames[spinnerFrame]}
                            </div>
                            <div style={{
                                color: 'var(--color-text-muted)',
                                fontSize: '0.875rem'
                            }}>
                                Loading diff viewer...
                            </div>
                        </div>
                    </div>
                }>
                    <MultiFileDiffPanel
                        files={multiFileEdit.files}
                        onClose={() => setMultiFileEdit(null)}
                        onApplyAll={handleMultiFileApply}
                        applying={multiFileApplying}
                        applied={applied}
                    />
                </Suspense>
            )}
        </div>
    );
}
