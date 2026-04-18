import { useState, useEffect, useRef, useCallback } from "react";
import { listNotifications, dismissNotification, deleteNotification, type Notification } from "../api";

export type { Notification };

const BASE = `http://${window.location.hostname || 'localhost'}:8000`;
const RECONNECT_DELAY_MS = 3000;

export function useNotifications() {
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [unreadCount, setUnreadCount] = useState(0);
    const [connected, setConnected] = useState(false);
    const esRef = useRef<EventSource | null>(null);
    const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const connect = useCallback(() => {
        if (esRef.current) {
            esRef.current.close();
        }

        const es = new EventSource(`${BASE}/notifications/stream`);
        esRef.current = es;

        es.onopen = () => setConnected(true);

        es.onmessage = (e) => {
            try {
                const data = JSON.parse(e.data);
                if (data.type === "connected") return;
                // New notification arrived — prepend it
                setNotifications(prev => [data, ...prev]);
                if (!data.read) {
                    setUnreadCount(c => c + 1);
                }
            } catch {
                // ignore malformed events
            }
        };

        es.onerror = () => {
            setConnected(false);
            es.close();
            esRef.current = null;
            reconnectTimer.current = setTimeout(connect, RECONNECT_DELAY_MS);
        };
    }, []);

    // Load initial notifications and connect SSE
    useEffect(() => {
        listNotifications(50)
            .then((data) => {
                setNotifications(data);
                setUnreadCount(data.filter(n => !n.read).length);
            })
            .catch(() => {});

        connect();

        return () => {
            esRef.current?.close();
            if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
        };
    }, [connect]);

    const dismiss = useCallback(async (id: string) => {
        await dismissNotification(id);
        setNotifications(prev =>
            prev.map(n => n.id === id ? { ...n, read: true } : n)
        );
        setUnreadCount(prev => Math.max(0, prev - 1));
    }, []);

    const remove = useCallback(async (id: string) => {
        await deleteNotification(id);
        setNotifications(prev => {
            const n = prev.find(n => n.id === id);
            if (n && !n.read) setUnreadCount(c => Math.max(0, c - 1));
            return prev.filter(n => n.id !== id);
        });
    }, []);

    return { notifications, unreadCount, connected, dismiss, remove };
}
