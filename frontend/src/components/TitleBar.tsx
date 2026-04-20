import { useEffect, useState } from "react";
import { Minus, Square, X } from "lucide-react";

declare global {
    interface Window {
        electronAPI?: {
            minimize: () => void;
            maximize: () => void;
            close: () => void;
            onMaximizeChange: (cb: (maximized: boolean) => void) => () => void;
        };
    }
}

export function TitleBar() {
    const [maximized, setMaximized] = useState(false);

    useEffect(() => {
        const cleanup = window.electronAPI?.onMaximizeChange(setMaximized);
        return cleanup;
    }, []);

    return (
        <div className="titlebar">
            <div className="titlebar-drag" />
            <div className="titlebar-controls">
                <button
                    className="titlebar-btn"
                    onClick={() => window.electronAPI?.minimize()}
                    title="Minimize"
                >
                    <Minus size={11} strokeWidth={2} />
                </button>
                <button
                    className="titlebar-btn"
                    onClick={() => window.electronAPI?.maximize()}
                    title={maximized ? "Restore" : "Maximize"}
                >
                    {maximized ? (
                        /* Restore icon: two overlapping squares */
                        <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.5">
                            <rect x="3" y="1" width="7" height="7" rx="0.5" />
                            <path d="M1 3v6.5a.5.5 0 0 0 .5.5H8" />
                        </svg>
                    ) : (
                        <Square size={11} strokeWidth={1.5} />
                    )}
                </button>
                <button
                    className="titlebar-btn titlebar-btn-close"
                    onClick={() => window.electronAPI?.close()}
                    title="Close"
                >
                    <X size={11} strokeWidth={2} />
                </button>
            </div>
        </div>
    );
}
