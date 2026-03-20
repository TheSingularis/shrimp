import { useState, useRef, useEffect } from "react";
import { type Message, sendChat } from "../api";
import ReactMarkdown from "react-markdown";

interface Props {
    scopes: string[];
}

export function ChatPanel({ scopes }: Props) {
    const [history, setHistory] = useState<Message[]>([]);
    const [input, setInput] = useState("");
    const [streaming, setStreaming] = useState(false);
    const bottomRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [history]);

    async function submit() {
        if (!input.trim() || streaming) return;

        const userMessage: Message = { role: "user", content: input };
        const newHistory = [...history, userMessage];
        setHistory([...newHistory, { role: "assistant", content: "" }]);
        setInput("");
        setStreaming(true);

        let fullResponse = "";

        await sendChat(input, scopes, history, (token) => {
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
                        <pre className="content">
                            <ReactMarkdown>{msg.content}</ReactMarkdown>
                        </pre>
                    </div>
                ))}
                {streaming && <div className="typing-indicator">▋</div>}
                <div ref={bottomRef}/>
            </div>
            <div className="input-row">
                <textarea 
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Ask something... (Enter to send, Shift+enter for newline)" //TODO: update this
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
