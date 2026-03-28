import { useState } from "react";
import { DiffEditor } from "@monaco-editor/react";
import { X, Check, Edit3 } from "lucide-react";
import "./MultiFileDiffPanel.css";

interface MultiFileDiff {
    scope: string;
    path: string;
    original: string;
    new: string;
}

interface Props {
    files: MultiFileDiff[];
    onClose: () => void;
    onApplyAll: (approvedPaths: string[]) => void;
    applying: boolean;
    applied: Record<string, boolean>;
}

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

    const currentFile = files[activeTab];
    const currentState = fileStates[currentFile.path];
    const isApplied = applied[currentFile.path];

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

            <div className="multi-diff-editor">
                <DiffEditor
                    height="100%"
                    language={getLanguageFromPath(currentFile.path)}
                    original={currentFile.original}
                    modified={currentFile.new}
                    theme="vs-dark"
                    options={{
                        readOnly: true,
                        renderSideBySide: true,
                        minimap: { enabled: false },
                        scrollBeyondLastLine: false,
                    }}
                />
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
