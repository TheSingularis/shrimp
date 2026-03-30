import { useState, useEffect, useMemo } from "react";
import {
    type ConversationMetadata,
    type Project,
    type Scope,
    listConversations,
    deleteConversation,
    updateConversationTitle,
    moveConversationToProject,
    createProject,
    updateProject,
    deleteProject,
    listProjects,
} from "../api";
import { X, ChevronRight, ChevronDown, FolderPlus, Folder, Settings } from "lucide-react";
import "./ConversationSidebar.css";

interface Props {
    open: boolean;
    onToggle: () => void;
    currentConversationId: string | null;
    onSelectConversation: (id: string) => void;
    onNewConversation: () => void;
    projects: Project[];
    onProjectsChange: (projects: Project[]) => void;
    scopes: Scope[];
    onConversationMoved?: (conversationId: string, projectId: string | null) => void;
}

export function ConversationSidebar({
    open,
    onToggle,
    currentConversationId,
    onSelectConversation,
    onNewConversation,
    projects,
    onProjectsChange,
    scopes,
    onConversationMoved,
}: Props) {
    const [conversations, setConversations] = useState<ConversationMetadata[]>([]);
    const [loading, setLoading] = useState(false);
    const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set(["uncategorized"]));
    const [contextMenu, setContextMenu] = useState<{
        conversationId: string;
        x: number;
        y: number;
    } | null>(null);
    const [draggedConversationId, setDraggedConversationId] = useState<string | null>(null);
    const [showProjectModal, setShowProjectModal] = useState(false);
    const [editingProject, setEditingProject] = useState<Project | null>(null);

    // Load expanded state from localStorage
    useEffect(() => {
        const saved = localStorage.getItem("expandedProjects");
        if (saved) {
            try {
                setExpandedProjects(new Set(JSON.parse(saved)));
            } catch (e) {
                console.error("Failed to load expanded projects:", e);
            }
        }
    }, []);

    // Save expanded state to localStorage
    useEffect(() => {
        localStorage.setItem("expandedProjects", JSON.stringify([...expandedProjects]));
    }, [expandedProjects]);

    useEffect(() => {
        if (open) {
            loadConversations();
        }
    }, [open]);

    async function loadConversations() {
        setLoading(true);
        try {
            const data = await listConversations();
            setConversations(data);
        } catch (error) {
            console.error("Failed to load conversations:", error);
        } finally {
            setLoading(false);
        }
    }

    async function refreshProjects() {
        try {
            const data = await listProjects();
            onProjectsChange(data.projects);
        } catch (error) {
            console.error("Failed to refresh projects:", error);
        }
    }

    // Group conversations by project
    const groupedConversations = useMemo(() => {
        const groups: Record<string, ConversationMetadata[]> = {
            uncategorized: [],
        };

        projects.forEach((p) => {
            groups[p.project_id] = [];
        });

        conversations.forEach((conv) => {
            const pid = conv.project_id;
            if (pid && groups[pid]) {
                groups[pid].push(conv);
            } else {
                groups.uncategorized.push(conv);
            }
        });

        return groups;
    }, [conversations, projects]);

    function toggleProject(projectId: string) {
        setExpandedProjects((prev) => {
            const next = new Set(prev);
            if (next.has(projectId)) {
                next.delete(projectId);
            } else {
                next.add(projectId);
            }
            return next;
        });
    }

    async function handleDelete(id: string, e: React.MouseEvent) {
        e.stopPropagation();

        if (!confirm("Delete this conversation?")) return;

        try {
            await deleteConversation(id);
            setConversations(conversations.filter((c) => c.conversation_id !== id));

            // If deleting current conversation, start new one
            if (id === currentConversationId) {
                onNewConversation();
            }
        } catch (error) {
            console.error("Failed to delete conversation:", error);
            alert("Failed to delete conversation");
        }
    }

    async function handleRename(id: string, currentTitle: string, e: React.MouseEvent) {
        e.stopPropagation();

        const newTitle = prompt("Enter new title:", currentTitle);
        if (!newTitle || newTitle === currentTitle) return;

        try {
            await updateConversationTitle(id, newTitle);
            setConversations(
                conversations.map((c) =>
                    c.conversation_id === id ? { ...c, title: newTitle } : c
                )
            );
        } catch (error) {
            console.error("Failed to rename conversation:", error);
            alert("Failed to rename conversation");
        }
    }

    function handleContextMenu(conversationId: string, e: React.MouseEvent) {
        e.preventDefault();
        setContextMenu({
            conversationId,
            x: e.clientX,
            y: e.clientY,
        });
    }

    async function handleMoveToProject(conversationId: string, projectId: string | null) {
        try {
            await moveConversationToProject(conversationId, projectId);
            setConversations(
                conversations.map((c) =>
                    c.conversation_id === conversationId ? { ...c, project_id: projectId } : c
                )
            );
            setContextMenu(null);

            // Notify parent if this is the current conversation
            if (conversationId === currentConversationId && onConversationMoved) {
                onConversationMoved(conversationId, projectId);
            }
        } catch (error) {
            console.error("Failed to move conversation:", error);
            alert("Failed to move conversation");
        }
    }

    function handleDragStart(conversationId: string) {
        setDraggedConversationId(conversationId);
    }

    function handleDragEnd() {
        setDraggedConversationId(null);
    }

    async function handleDrop(projectId: string | null) {
        if (draggedConversationId) {
            await handleMoveToProject(draggedConversationId, projectId);
            setDraggedConversationId(null);
        }
    }

    async function handleSaveProject(
        name: string,
        description: string,
        color: string,
        settings: { default_scopes: string[]; custom_instructions: string }
    ) {
        try {
            if (editingProject) {
                // Update existing project
                await updateProject(editingProject.project_id, {
                    name,
                    description,
                    color,
                    settings,
                });
            } else {
                // Create new project
                await createProject(name, description, color, settings);
            }
            await refreshProjects();
            setShowProjectModal(false);
            setEditingProject(null);
        } catch (error) {
            console.error("Failed to save project:", error);
            alert(`Failed to ${editingProject ? "update" : "create"} project`);
        }
    }

    function handleEditProject(project: Project, e: React.MouseEvent) {
        e.stopPropagation();
        setEditingProject(project);
        setShowProjectModal(true);
    }

    async function handleDeleteProject(projectId: string, e: React.MouseEvent) {
        e.stopPropagation();

        if (!confirm("Delete this project? Conversations will be moved to Uncategorized.")) return;

        try {
            await deleteProject(projectId);
            await refreshProjects();
            await loadConversations();
        } catch (error) {
            console.error("Failed to delete project:", error);
            alert("Failed to delete project");
        }
    }

    function formatDate(dateString: string): string {
        const date = new Date(dateString);
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);

        if (diffMins < 1) return "Just now";
        if (diffMins < 60) return `${diffMins}m ago`;
        if (diffHours < 24) return `${diffHours}h ago`;
        if (diffDays < 7) return `${diffDays}d ago`;

        return date.toLocaleDateString();
    }

    return (
        <>
            {/* Toggle button */}
            <button
                onClick={onToggle}
                className="sidebar-toggle"
                title={open ? "Close sidebar" : "Open sidebar"}
            >
                {open ? "◀" : "▶"}
            </button>

            {/* Sidebar */}
            <div className={`conversation-sidebar ${open ? "open" : ""}`}>
                <div className="sidebar-header">
                    <h2>Conversations</h2>
                    <button onClick={onNewConversation} className="new-conversation-btn">
                        + New
                    </button>
                </div>

                <div className="conversation-list">
                    {loading ? (
                        <div className="loading">Loading...</div>
                    ) : (
                        <>
                            {/* Render projects */}
                            {projects.map((project) => (
                                <ProjectSection
                                    key={project.project_id}
                                    project={project}
                                    conversations={groupedConversations[project.project_id] || []}
                                    expanded={expandedProjects.has(project.project_id)}
                                    onToggle={() => toggleProject(project.project_id)}
                                    currentConversationId={currentConversationId}
                                    onSelectConversation={onSelectConversation}
                                    onDelete={handleDelete}
                                    onRename={handleRename}
                                    onContextMenu={handleContextMenu}
                                    onEditProject={handleEditProject}
                                    onDeleteProject={handleDeleteProject}
                                    formatDate={formatDate}
                                    onDragStart={handleDragStart}
                                    onDragEnd={handleDragEnd}
                                    onDrop={() => handleDrop(project.project_id)}
                                    isDraggedOver={false}
                                />
                            ))}

                            {/* Uncategorized section */}
                            <UncategorizedSection
                                conversations={groupedConversations.uncategorized}
                                expanded={expandedProjects.has("uncategorized")}
                                onToggle={() => toggleProject("uncategorized")}
                                currentConversationId={currentConversationId}
                                onSelectConversation={onSelectConversation}
                                onDelete={handleDelete}
                                onRename={handleRename}
                                onContextMenu={handleContextMenu}
                                formatDate={formatDate}
                                onDragStart={handleDragStart}
                                onDragEnd={handleDragEnd}
                                onDrop={() => handleDrop(null)}
                            />

                            <button className="new-project-btn" onClick={() => setShowProjectModal(true)}>
                                <FolderPlus size={16} />
                                <span>New Project</span>
                            </button>
                        </>
                    )}
                </div>
            </div>

            {/* Context menu for moving conversations */}
            {contextMenu && (
                <ContextMenu
                    x={contextMenu.x}
                    y={contextMenu.y}
                    conversationId={contextMenu.conversationId}
                    projects={projects}
                    onMove={handleMoveToProject}
                    onClose={() => setContextMenu(null)}
                />
            )}

            {/* Project creation/edit modal */}
            {showProjectModal && (
                <ProjectModal
                    project={editingProject}
                    scopes={scopes}
                    onClose={() => {
                        setShowProjectModal(false);
                        setEditingProject(null);
                    }}
                    onSave={handleSaveProject}
                />
            )}

            {/* Overlay for mobile */}
            {open && <div className="sidebar-overlay" onClick={onToggle} />}
        </>
    );
}

interface ProjectSectionProps {
    project: Project;
    conversations: ConversationMetadata[];
    expanded: boolean;
    onToggle: () => void;
    currentConversationId: string | null;
    onSelectConversation: (id: string) => void;
    onDelete: (id: string, e: React.MouseEvent) => void;
    onRename: (id: string, title: string, e: React.MouseEvent) => void;
    onContextMenu: (id: string, e: React.MouseEvent) => void;
    onEditProject: (project: Project, e: React.MouseEvent) => void;
    onDeleteProject: (id: string, e: React.MouseEvent) => void;
    formatDate: (date: string) => string;
    onDragStart: (id: string) => void;
    onDragEnd: () => void;
    onDrop: () => void;
    isDraggedOver: boolean;
}

function ProjectSection({
    project,
    conversations,
    expanded,
    onToggle,
    currentConversationId,
    onSelectConversation,
    onDelete,
    onRename,
    onContextMenu,
    onEditProject,
    onDeleteProject,
    formatDate,
    onDragStart,
    onDragEnd,
    onDrop,
    isDraggedOver,
}: ProjectSectionProps) {
    const [dragOver, setDragOver] = useState(false);

    function handleDragOver(e: React.DragEvent) {
        e.preventDefault();
        setDragOver(true);
    }

    function handleDragLeave() {
        setDragOver(false);
    }

    function handleDrop(e: React.DragEvent) {
        e.preventDefault();
        setDragOver(false);
        onDrop();
    }

    return (
        <div
            className={`project-section ${dragOver ? "drag-over" : ""}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
        >
            <div className="project-header">
                <div className="project-header-content" onClick={onToggle}>
                    {expanded ? (
                        <ChevronDown size={16} className="project-expand-icon" />
                    ) : (
                        <ChevronRight size={16} className="project-expand-icon" />
                    )}
                    <div
                        className="project-color-indicator"
                        style={{ background: project.color }}
                    />
                    <span className="project-name">{project.name}</span>
                    <span className="project-count">({conversations.length})</span>
                </div>
                <div className="project-actions">
                    <button
                        className="edit-project-btn"
                        onClick={(e) => onEditProject(project, e)}
                        title="Edit project settings"
                    >
                        <Settings size={14} />
                    </button>
                    <button
                        className="delete-project-btn"
                        onClick={(e) => onDeleteProject(project.project_id, e)}
                        title="Delete project"
                    >
                        <X size={14} />
                    </button>
                </div>
            </div>

            {expanded && (
                <div className="project-conversations">
                    {conversations.length === 0 ? (
                        <div className="empty-project">Drop conversations here</div>
                    ) : (
                        conversations.map((conv) => (
                            <ConversationItem
                                key={conv.conversation_id}
                                conversation={conv}
                                active={conv.conversation_id === currentConversationId}
                                onSelect={onSelectConversation}
                                onDelete={onDelete}
                                onRename={onRename}
                                onContextMenu={onContextMenu}
                                formatDate={formatDate}
                                onDragStart={onDragStart}
                                onDragEnd={onDragEnd}
                            />
                        ))
                    )}
                </div>
            )}
        </div>
    );
}

interface ConversationItemProps {
    conversation: ConversationMetadata;
    active: boolean;
    onSelect: (id: string) => void;
    onDelete: (id: string, e: React.MouseEvent) => void;
    onRename: (id: string, title: string, e: React.MouseEvent) => void;
    onContextMenu: (id: string, e: React.MouseEvent) => void;
    formatDate: (date: string) => string;
    onDragStart: (id: string) => void;
    onDragEnd: () => void;
}

function ConversationItem({
    conversation,
    active,
    onSelect,
    onDelete,
    onRename,
    onContextMenu,
    formatDate,
    onDragStart,
    onDragEnd,
}: ConversationItemProps) {
    return (
        <div
            className={`conversation-item ${active ? "active" : ""}`}
            draggable
            onDragStart={() => onDragStart(conversation.conversation_id)}
            onDragEnd={onDragEnd}
            onClick={() => onSelect(conversation.conversation_id)}
            onContextMenu={(e) => onContextMenu(conversation.conversation_id, e)}
        >
            <div
                className="conversation-title"
                onDoubleClick={(e) =>
                    onRename(conversation.conversation_id, conversation.title, e)
                }
                title="Drag to move, double-click to rename, right-click for menu"
            >
                {conversation.title}
            </div>
            <div className="conversation-meta">
                {formatDate(conversation.updated_at)} · {conversation.message_count} messages
            </div>
            <button
                className="delete-conversation-btn"
                onClick={(e) => onDelete(conversation.conversation_id, e)}
                title="Delete conversation"
            >
                <X size={14} />
            </button>
        </div>
    );
}

interface UncategorizedSectionProps {
    conversations: ConversationMetadata[];
    expanded: boolean;
    onToggle: () => void;
    currentConversationId: string | null;
    onSelectConversation: (id: string) => void;
    onDelete: (id: string, e: React.MouseEvent) => void;
    onRename: (id: string, title: string, e: React.MouseEvent) => void;
    onContextMenu: (id: string, e: React.MouseEvent) => void;
    formatDate: (date: string) => string;
    onDragStart: (id: string) => void;
    onDragEnd: () => void;
    onDrop: () => void;
}

function UncategorizedSection({
    conversations,
    expanded,
    onToggle,
    currentConversationId,
    onSelectConversation,
    onDelete,
    onRename,
    onContextMenu,
    formatDate,
    onDragStart,
    onDragEnd,
    onDrop,
}: UncategorizedSectionProps) {
    const [dragOver, setDragOver] = useState(false);

    function handleDragOver(e: React.DragEvent) {
        e.preventDefault();
        setDragOver(true);
    }

    function handleDragLeave() {
        setDragOver(false);
    }

    function handleDrop(e: React.DragEvent) {
        e.preventDefault();
        setDragOver(false);
        onDrop();
    }

    return (
        <div
            className={`project-section ${dragOver ? "drag-over" : ""}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
        >
            <div className="project-header">
                <div className="project-header-content" onClick={onToggle}>
                    {expanded ? (
                        <ChevronDown size={16} className="project-expand-icon" />
                    ) : (
                        <ChevronRight size={16} className="project-expand-icon" />
                    )}
                    <Folder size={16} className="project-folder-icon" />
                    <span className="project-name">Uncategorized</span>
                    <span className="project-count">({conversations.length})</span>
                </div>
            </div>

            {expanded && (
                <div className="project-conversations">
                    {conversations.length === 0 ? (
                        <div className="empty-project">Drop conversations here</div>
                    ) : (
                        conversations.map((conv) => (
                            <ConversationItem
                                key={conv.conversation_id}
                                conversation={conv}
                                active={conv.conversation_id === currentConversationId}
                                onSelect={onSelectConversation}
                                onDelete={onDelete}
                                onRename={onRename}
                                onContextMenu={onContextMenu}
                                formatDate={formatDate}
                                onDragStart={onDragStart}
                                onDragEnd={onDragEnd}
                            />
                        ))
                    )}
                </div>
            )}
        </div>
    );
}

interface ProjectModalProps {
    project: Project | null;
    scopes: Scope[];
    onClose: () => void;
    onSave: (
        name: string,
        description: string,
        color: string,
        settings: { default_scopes: string[]; custom_instructions: string }
    ) => void;
}

function ProjectModal({ project, scopes, onClose, onSave }: ProjectModalProps) {
    const [name, setName] = useState(project?.name || "");
    const [description, setDescription] = useState(project?.description || "");
    const [color, setColor] = useState(project?.color || "#3b82f6");
    const [defaultScopes, setDefaultScopes] = useState<string[]>(
        project?.settings.default_scopes || []
    );
    const [customInstructions, setCustomInstructions] = useState(
        project?.settings.custom_instructions || ""
    );

    const predefinedColors = [
        "#3b82f6", // blue
        "#8b5cf6", // purple
        "#ec4899", // pink
        "#f59e0b", // orange
        "#10b981", // green
        "#ef4444", // red
        "#06b6d4", // cyan
        "#f97316", // orange-red
    ];

    function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (name.trim()) {
            onSave(name.trim(), description.trim(), color, {
                default_scopes: defaultScopes,
                custom_instructions: customInstructions.trim(),
            });
        }
    }

    function toggleScope(scopeName: string) {
        setDefaultScopes((prev) =>
            prev.includes(scopeName)
                ? prev.filter((s) => s !== scopeName)
                : [...prev, scopeName]
        );
    }

    useEffect(() => {
        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        document.addEventListener("keydown", handleEscape);
        return () => document.removeEventListener("keydown", handleEscape);
    }, [onClose]);

    return (
        <div className="modal-backdrop" onClick={onClose}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <h3>{project ? "Edit Project" : "New Project"}</h3>
                    <button className="modal-close-btn" onClick={onClose}>
                        <X size={18} />
                    </button>
                </div>

                <form onSubmit={handleSubmit}>
                    <div className="modal-body">
                        <label>
                            <span className="label-text">Name</span>
                            <input
                                type="text"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder="My Project"
                                autoFocus
                                required
                            />
                        </label>

                        <label>
                            <span className="label-text">Description (optional)</span>
                            <textarea
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                placeholder="What's this project about?"
                                rows={3}
                            />
                        </label>

                        <div className="color-picker-group">
                            <span className="label-text">Color</span>
                            <div className="color-picker-grid">
                                {predefinedColors.map((c) => (
                                    <button
                                        key={c}
                                        type="button"
                                        className={`color-option ${color === c ? "selected" : ""}`}
                                        style={{ background: c }}
                                        onClick={() => setColor(c)}
                                        title={c}
                                    />
                                ))}
                            </div>
                        </div>

                        <div className="scopes-group">
                            <span className="label-text">Default Scopes</span>
                            <div className="scopes-pills">
                                {scopes.length === 0 ? (
                                    <div className="empty-scopes">No scopes configured yet</div>
                                ) : (
                                    scopes
                                        .filter((s) => s.enabled)
                                        .map((scope) => (
                                            <button
                                                key={scope.name}
                                                type="button"
                                                className={`scope-pill-modal ${
                                                    defaultScopes.includes(scope.name) ? "active" : ""
                                                }`}
                                                onClick={() => toggleScope(scope.name)}
                                            >
                                                {scope.name}
                                            </button>
                                        ))
                                )}
                            </div>
                        </div>

                        <label>
                            <span className="label-text">Custom Instructions (optional)</span>
                            <textarea
                                value={customInstructions}
                                onChange={(e) => setCustomInstructions(e.target.value)}
                                placeholder="Additional instructions for conversations in this project..."
                                rows={4}
                            />
                        </label>
                    </div>

                    <div className="modal-footer">
                        <button type="button" onClick={onClose} className="btn-secondary">
                            Cancel
                        </button>
                        <button type="submit" className="btn-primary" disabled={!name.trim()}>
                            {project ? "Save Changes" : "Create Project"}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

interface ContextMenuProps {
    x: number;
    y: number;
    conversationId: string;
    projects: Project[];
    onMove: (conversationId: string, projectId: string | null) => void;
    onClose: () => void;
}

function ContextMenu({ x, y, conversationId, projects, onMove, onClose }: ContextMenuProps) {
    useEffect(() => {
        const handleClick = () => onClose();
        document.addEventListener("click", handleClick);
        return () => document.removeEventListener("click", handleClick);
    }, [onClose]);

    return (
        <div
            className="context-menu"
            style={{ left: x, top: y }}
            onClick={(e) => e.stopPropagation()}
        >
            <div className="context-menu-label">Move to:</div>
            {projects.map((p) => (
                <button
                    key={p.project_id}
                    className="context-menu-item"
                    onClick={() => onMove(conversationId, p.project_id)}
                >
                    <div
                        className="project-color-dot"
                        style={{ background: p.color }}
                    />
                    {p.name}
                </button>
            ))}
            <button
                className="context-menu-item"
                onClick={() => onMove(conversationId, null)}
            >
                Uncategorized
            </button>
        </div>
    );
}
