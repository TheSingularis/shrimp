import { useState, useRef, useEffect } from "react";
import { type Message, sendChat } from "../api";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import cliSpinners from "cli-spinners";

interface Props {
    scopes: string[];
}

const mdComponents: Components = {
    // pre is always a transparent passthrough — the code component returns a self-contained
    // <div>, so wrapping it in a <pre> would produce invalid HTML (block inside inline).
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

        if (lang) {
            // Any fenced block with a language tag (including ```markdown) gets
            // syntax-highlighted and shown as a code block — never stripped or recursed.
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

        // No language tag — render plain text, no <code> wrapper.
        // The surrounding prose styling handles it.
        return <>{raw}</>;
    },
};

export function ChatPanel({ scopes }: Props) {
    const [history, setHistory] = useState<Message[]>([]);
    const [input, setInput] = useState("");
    const [streaming, setStreaming] = useState(false);
    const [responseStarted, setResponseStarted] = useState(false);
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
        setHistory([...newHistory, { role: "assistant", content: "" }]);
        setInput("");
        setStreaming(true);
        setResponseStarted(false);

        let fullResponse = "";

        await sendChat(input, scopes, history, (token) => {
            if (!responseStarted) setResponseStarted(true);
            fullResponse += token;
            setHistory([
                ...newHistory,
                { role: "assistant", content: fullResponse },
            ]);
        });

        setStreaming(false);
    }

    function handleKeyDown(e: React.KeyboardEvent) {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
        }
    }

    return (
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
    );
}
