import { useState, useEffect } from "react";
import { DiffEditor } from "@monaco-editor/react";
import { X, Check, Edit3, Loader2 } from "lucide-react";
import "./MultiFileDiffPanel.css";

interface MultiFileDiff {
    scope: string;
    path: string;
    original: string;
    new: string;
}

// Deferred diff computation component
// Mounts Monaco immediately but defers loading file content until browser is idle
function DeferredDiffEditor({ original, modified, language, options }: {
    original: string;
    modified: string;
    language: string;
    options: any;
}) {
    const [content, setContent] = useState<{ original: string; modified: string } | null>(null);
    const [isComputing, setIsComputing] = useState(true);

    useEffect(() => {
        // Defer diff computation using requestIdleCallback
        const callback = () => {
            setContent({ original, modified });
            // Add small delay to let Monaco render before marking as done
            setTimeout(() => setIsComputing(false), 100);
        };

        const requestIdleCB = (window as any).requestIdleCallback || ((cb: any) => setTimeout(cb, 1));
        const handle = requestIdleCB(callback, { timeout: 200 });

        return () => {
            const cancelIdleCB = (window as any).cancelIdleCallback || clearTimeout;
            cancelIdleCB(handle);
        };
    }, [original, modified]);

    if (!content) {
        return (
            <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                height: '100%',
                color: 'var(--color-text-muted)',
                gap: '0.75rem'
            }}>
                <Loader2 size={20} className="spin" />
                <span>Preparing diff...</span>
            </div>
        );
    }

    return (
        <>
            {isComputing && (
                <div style={{
                    position: 'absolute',
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)',
                    zIndex: 1000,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.75rem',
                    background: 'var(--color-bg-elevated)',
                    padding: '1rem 1.5rem',
                    borderRadius: '0.5rem',
                    border: '1px solid var(--color-border)',
                    color: 'var(--color-text-muted)',
                    pointerEvents: 'none'
                }}>
                    <Loader2 size={20} className="spin" />
                    <span>Computing diff...</span>
                </div>
            )}
            <DiffEditor
                height="100%"
                language={language}
                original={content.original}
                modified={content.modified}
                theme="vs-dark"
                options={options}
            />
        </>
    );
}

interface Props {
    files: MultiFileDiff[];
    onClose: () => void;
    onApplyAll: (approvedPaths: string[]) => void;
    applying: boolean;
    applied: Record<string, boolean>;
}

// Two-stage deferred rendering to prevent UI freeze:
// 1. Defer tab initialization (which tabs to render)
// 2. Defer diff computation (when to load file content into Monaco)
// This allows UI to remain responsive even with large files
export function MultiFileDiffPanel({ files, onClose, onApplyAll, applying, applied }: Props) {
    const [activeTab, setActiveTab] = useState(0);
    const [fileStates, setFileStates] = useState<Record<string, {
        approved: boolean;
        rejected: boolean;
    }>>(
        Object.fromEntries(
            files.map(f => [f.path, { approved: false, rejected: false }])
        )
    );
    const [initializedTabs, setInitializedTabs] = useState<Set<number>>(new Set());

    const currentFile = files[activeTab];
    const currentState = fileStates[currentFile.path];
    const isApplied = applied[currentFile.path];

    // Defer Monaco initialization for active tab using requestIdleCallback
    useEffect(() => {
        if (initializedTabs.has(activeTab)) {
            return; // Already initialized
        }

        // Use requestIdleCallback to defer work until browser is idle
        const callback = (deadline?: IdleDeadline) => {
            // Initialize active tab
            setInitializedTabs(prev => new Set(prev).add(activeTab));

            // Pre-load next tab if we have time remaining
            const nextTab = activeTab + 1;
            if (nextTab < files.length && deadline && deadline.timeRemaining() > 50) {
                setInitializedTabs(prev => new Set(prev).add(nextTab));
            }
        };

        const requestIdleCB = (window as any).requestIdleCallback || ((cb: any) => setTimeout(cb, 1));
        const handle = requestIdleCB(callback, { timeout: 100 });

        return () => {
            const cancelIdleCB = (window as any).cancelIdleCallback || clearTimeout;
            cancelIdleCB(handle);
        };
    }, [activeTab, files.length, initializedTabs]);

    const approvedFiles = files.filter(f => fileStates[f.path].approved);
    const canApply = approvedFiles.length > 0 && !applying;

    function handleApprove(path: string) {
        setFileStates(prev => ({
            ...prev,
            [path]: { approved: true, rejected: false }
        }));
    }

    function handleReject(path: string) {
        setFileStates(prev => ({
            ...prev,
            [path]: { approved: false, rejected: true }
        }));
    }

    function handleApplyAll() {
        const approvedPaths = files
            .filter(f => fileStates[f.path].approved)
            .map(f => f.path);
        onApplyAll(approvedPaths);
    }

    return (
        <div className="multi-diff-panel">
            <div className="multi-diff-header">
                <div className="multi-diff-title">
                    <Edit3 size={16} className="multi-diff-icon" />
                    <span>Multi-File Edit Proposal ({files.length} files)</span>
                </div>
                <button className="close-btn" onClick={onClose} disabled={applying}>
                    <X size={18} />
                </button>
            </div>

            <div className="multi-diff-tabs">
                {files.map((file, idx) => {
                    const state = fileStates[file.path];
                    const isApplied = applied[file.path];
                    const filename = file.path.split("/").pop() ?? file.path;
                    const isNewFile = !file.original || file.original.trim() === "";

                    let statusIcon: JSX.Element | null = null;
                    let statusClass = "";
                    if (isApplied) {
                        statusIcon = <Check size={14} />;
                        statusClass = "applied";
                    } else if (state.approved) {
                        statusIcon = <Check size={14} />;
                        statusClass = "approved";
                    } else if (state.rejected) {
                        statusIcon = <X size={14} />;
                        statusClass = "rejected";
                    }

                    return (
                        <button
                            key={file.path}
                            className={`multi-diff-tab ${activeTab === idx ? "active" : ""} ${statusClass}`}
                            onClick={() => setActiveTab(idx)}
                            title={file.path}
                        >
                            {statusIcon && <span className="tab-status-icon">{statusIcon}</span>}
                            <span className="tab-filename">
                                {filename}
                                {isNewFile && <span className="new-file-badge">new</span>}
                            </span>
                        </button>
                    );
                })}
            </div>

            <div className="multi-diff-editor" style={{ position: 'relative' }}>
                {initializedTabs.has(activeTab) ? (
                    <DeferredDiffEditor
                        language={getLanguageFromPath(currentFile.path)}
                        original={currentFile.original}
                        modified={currentFile.new}
                        options={{
                            readOnly: true,
                            renderSideBySide: true,
                            minimap: { enabled: false },
                            scrollBeyondLastLine: false,
                        }}
                    />
                ) : (
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        height: '100%',
                        color: 'var(--color-text-muted)',
                        gap: '0.75rem'
                    }}>
                        <Loader2 size={20} className="spin" />
                        <span>Loading diff editor...</span>
                    </div>
                )}
            </div>

            <div className="multi-diff-actions">
                <div className="multi-diff-file-actions">
                    {!isApplied && !currentState.rejected && (
                        <>
                            <button
                                className={`approve-btn ${currentState.approved ? "active" : ""}`}
                                onClick={() => handleApprove(currentFile.path)}
                                disabled={applying}
                            >
                                {currentState.approved ? <><Check size={14} /> Approved</> : "Approve"}
                            </button>
                            <button
                                className="reject-btn"
                                onClick={() => handleReject(currentFile.path)}
                                disabled={applying}
                            >
                                Reject
                            </button>
                        </>
                    )}
                    {currentState.rejected && !isApplied && (
                        <span className="rejected-label">Rejected</span>
                    )}
                    {isApplied && (
                        <span className="applied-label">
                            <Check size={14} /> Applied
                        </span>
                    )}
                </div>
                <button
                    className="apply-all-btn"
                    onClick={handleApplyAll}
                    disabled={!canApply}
                >
                    {applying
                        ? "Applying..."
                        : `Apply All Approved (${approvedFiles.length}/${files.length})`}
                </button>
            </div>
        </div>
    );
}

function getLanguageFromPath(path: string): string {
    const ext = path.split(".").pop()?.toLowerCase();
    const languageMap: Record<string, string> = {
        ts: "typescript",
        tsx: "typescript",
        js: "javascript",
        jsx: "javascript",
        py: "python",
        md: "markdown",
        json: "json",
        yaml: "yaml",
        yml: "yaml",
        toml: "toml",
        sh: "shell",
        rs: "rust",
        go: "go",
        java: "java",
        c: "c",
        cpp: "cpp",
        h: "c",
    };
    return languageMap[ext || ""] || "plaintext";
}
