import { DiffEditor } from "@monaco-editor/react";
import { X, Check, Edit3 } from "lucide-react";
import "./DiffPanel.css";

interface Props {
    path: string;
    originalContent: string;
    newContent: string;
    onClose: () => void;
    onApply: () => void;
    onDiscard: () => void;
    applying: boolean;
    applied: boolean;
}

export function DiffPanel({
    path,
    originalContent,
    newContent,
    onClose,
    onApply,
    onDiscard,
    applying,
    applied
}: Props) {
    const ext = path.split(".").pop()?.toLowerCase() ?? "";
    const langMap: Record<string, string> = {
        py: "python", ts: "typescript", tsx: "typescript",
        js: "javascript", jsx: "javascript", json: "json",
        md: "markdown", yaml: "yaml", yml: "yaml",
        toml: "toml", sh: "shell", rs: "rust", go: "go",
        java: "java", c: "c", cpp: "cpp", h: "cpp", txt: "plaintext",
    };
    const language = langMap[ext] ?? "plaintext";
    const filename = path.split("/").pop() ?? path;

        return (
        <div className="diff-panel">
            <div className="diff-panel-header">
                <span className="diff-panel-title">
                    <Edit3 size={16} className="diff-panel-icon" />
                    {filename}
                </span>
                <span className="diff-panel-path">{path}</span>
                <div className="diff-panel-actions">
                    {!applied && (
                        <>
                        <button
                            className="discard-btn"
                            onClick={onDiscard}
                            disabled={applying}
                        >
                            discard
                        </button>
                        <button
                            className="apply-btn"
                            onClick={onApply}
                            disabled={applying}
                            >
                            {applying ? "applying…" : "apply"}
                        </button>
                            </>
                    )}
                    {applied && (
                        <span className="diff-panel-applied">
                            <Check size={14} /> applied
                        </span>
                    )}
                    <button className="close-btn" onClick={onClose}>
                        <X size={18} />
                    </button>
                </div>
            </div>
            <div className="diff-panel-editor">
                <DiffEditor
                    original={originalContent}
                    modified={newContent}
                    language={language}
                    theme="vs-dark"
                    options={{
                        readOnly: true,
                        renderSideBySide: true,
                        minimap: { enabled: false },
                        scrollBeyondLastLine: false,
                        fontSize: 13,
                        lineNumbers: "on",
                        wordWrap: "on",
                        renderOverviewRuler: false,
                    }}
                    height="100%"
                />
            </div>
        </div>
    );
}
