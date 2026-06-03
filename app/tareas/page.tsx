"use client";
import { useEffect, useState } from "react";
import { Plus, X, CheckSquare, Clock, AlertCircle, CheckCircle, Ban } from "lucide-react";

interface Task {
  id: string;
  title: string;
  description?: string;
  status: string;
  priority: string;
  category?: string;
  brand?: { name: string };
}

const COLUMNS = [
  { key: "pending",     label: "Pendiente",    icon: Clock,        color: "#F59E0B", bg: "#FEF3C7", textColor: "#92400E" },
  { key: "in_progress", label: "En Proceso",   icon: AlertCircle,  color: "#2563EB", bg: "#DBEAFE", textColor: "#1E40AF" },
  { key: "review",      label: "En Revisión",  icon: CheckSquare,  color: "#7C3AED", bg: "#EDE9FE", textColor: "#5B21B6" },
  { key: "done",        label: "Hecho",        icon: CheckCircle,  color: "#00A676", bg: "#D1FAE5", textColor: "#065F46" },
  { key: "blocked",     label: "Bloqueado",    icon: Ban,          color: "#DC2626", bg: "#FEE2E2", textColor: "#991B1B" },
];

const PRIORITY_COLOR: Record<string, string> = {
  high:   "#DC2626",
  medium: "#F59E0B",
  low:    "#9CA3AF",
};

const PRIORITY_LABEL: Record<string, string> = {
  high: "Alta", medium: "Media", low: "Baja",
};

export default function TareasPage() {
  const [tasks, setTasks]   = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding]  = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [newPriority, setNewPriority] = useState("medium");

  useEffect(() => {
    fetch("/api/tasks")
      .then((r) => r.json())
      .then((d) => { setTasks(d.tasks); setLoading(false); });
  }, []);

  const moveTask = async (id: string, status: string) => {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, status } : t)));
    await fetch("/api/tasks", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status }),
    });
  };

  const deleteTask = async (id: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== id));
    await fetch("/api/tasks", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
  };

  const addTask = async (status: string) => {
    if (!newTitle.trim()) return;
    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: newTitle.trim(), status, priority: newPriority }),
    });
    const task = await res.json();
    setTasks((prev) => [...prev, task]);
    setNewTitle("");
    setNewPriority("medium");
    setAdding(null);
  };

  const pending = tasks.filter((t) => t.status !== "done").length;
  const done    = tasks.filter((t) => t.status === "done").length;

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)" }}>

      {/* ── Header ─────────────────────────────── */}
      <div className="page-header" style={{ padding: "12px 32px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div>
            <p style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", lineHeight: 1.2 }}>
              Tareas
            </p>
            <p style={{ fontSize: 11, color: "var(--text-3)", marginTop: 1 }}>
              {pending} pendiente{pending !== 1 ? "s" : ""} · {done} completada{done !== 1 ? "s" : ""}
            </p>
          </div>

          <div style={{ flex: 1 }} />

          {/* Totals pills */}
          {COLUMNS.map((col) => {
            const count = tasks.filter((t) => t.status === col.key).length;
            return (
              <div key={col.key} style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "5px 12px", borderRadius: 8,
                background: col.bg, border: `1.5px solid ${col.color}30`,
              }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: col.textColor }}>{col.label}</span>
                <span style={{
                  fontSize: 11, fontWeight: 800, color: "#fff",
                  background: col.color, borderRadius: 20, padding: "1px 7px",
                  minWidth: 20, textAlign: "center",
                }}>
                  {count}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Board ──────────────────────────────── */}
      <div style={{ padding: "24px 32px" }}>
        {loading ? (
          <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: 200 }}>
            <div style={{
              width: 32, height: 32, borderRadius: "50%",
              border: "2.5px solid #E5E7EB", borderTopColor: "#0E766E",
              animation: "spin 0.8s linear infinite",
            }} />
          </div>
        ) : (
          <div style={{ display: "flex", gap: 16, overflowX: "auto", paddingBottom: 24, minHeight: "calc(100vh - 160px)", alignItems: "flex-start" }}>
            {COLUMNS.map((col) => {
              const Icon = col.icon;
              const colTasks = tasks.filter((t) => t.status === col.key);

              return (
                <div key={col.key} style={{ flexShrink: 0, width: 280 }}>

                  {/* Column header */}
                  <div style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    marginBottom: 12, padding: "10px 14px", borderRadius: 10,
                    background: col.bg, border: `1.5px solid ${col.color}30`,
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <Icon size={14} style={{ color: col.color }} />
                      <span style={{ fontSize: 13, fontWeight: 700, color: col.textColor }}>{col.label}</span>
                      <span style={{
                        fontSize: 11, fontWeight: 800, color: "#fff",
                        background: col.color, borderRadius: 20, padding: "1px 7px",
                        minWidth: 20, textAlign: "center",
                      }}>
                        {colTasks.length}
                      </span>
                    </div>
                    <button
                      onClick={() => { setAdding(col.key); setNewTitle(""); setNewPriority("medium"); }}
                      style={{
                        width: 26, height: 26, borderRadius: 6,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        background: col.color, border: "none", cursor: "pointer",
                        color: "#fff",
                      }}
                    >
                      <Plus size={14} />
                    </button>
                  </div>

                  {/* Add form */}
                  {adding === col.key && (
                    <div style={{
                      borderRadius: 12, padding: 14, marginBottom: 10,
                      background: "var(--card)",
                      border: `2px solid ${col.color}`,
                      boxShadow: `0 0 0 3px ${col.color}20`,
                    }}>
                      <input
                        autoFocus
                        value={newTitle}
                        onChange={(e) => setNewTitle(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") addTask(col.key);
                          if (e.key === "Escape") setAdding(null);
                        }}
                        placeholder="Título de la tarea..."
                        style={{
                          width: "100%", background: "transparent",
                          border: "none", outline: "none",
                          fontSize: 13, fontWeight: 500, color: "var(--text)",
                          marginBottom: 10, caretColor: col.color,
                        }}
                      />
                      {/* Priority selector */}
                      <div style={{ display: "flex", gap: 5, marginBottom: 10 }}>
                        {["high", "medium", "low"].map((p) => (
                          <button
                            key={p}
                            onClick={() => setNewPriority(p)}
                            style={{
                              padding: "3px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600,
                              cursor: "pointer",
                              background: newPriority === p ? PRIORITY_COLOR[p] : "var(--bg-2)",
                              color: newPriority === p ? "#fff" : "var(--text-2)",
                              border: `1px solid ${newPriority === p ? PRIORITY_COLOR[p] : "var(--border)"}`,
                            }}
                          >
                            {PRIORITY_LABEL[p]}
                          </button>
                        ))}
                      </div>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button
                          onClick={() => addTask(col.key)}
                          style={{
                            padding: "6px 14px", borderRadius: 8, fontSize: 12, fontWeight: 700,
                            background: col.color, color: "#fff", border: "none", cursor: "pointer",
                          }}
                        >
                          Agregar
                        </button>
                        <button
                          onClick={() => setAdding(null)}
                          style={{
                            padding: "6px 12px", borderRadius: 8, fontSize: 12, fontWeight: 600,
                            background: "var(--bg-2)", color: "var(--text-2)", border: "1px solid var(--border)", cursor: "pointer",
                          }}
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Task cards */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {colTasks.map((task) => (
                      <div
                        key={task.id}
                        style={{
                          borderRadius: 12, padding: "12px 14px",
                          background: "var(--card)",
                          border: "1px solid var(--border)",
                          borderLeft: `4px solid ${PRIORITY_COLOR[task.priority] ?? "var(--border)"}`,
                          boxShadow: "0 1px 3px var(--shadow)",
                          cursor: "default",
                          position: "relative",
                        }}
                        className="task-card"
                      >
                        {/* Delete */}
                        <button
                          onClick={() => deleteTask(task.id)}
                          className="task-delete"
                          style={{
                            position: "absolute", top: 8, right: 8,
                            width: 22, height: 22, borderRadius: 6,
                            display: "flex", alignItems: "center", justifyContent: "center",
                            background: "var(--red-bg)", color: "var(--red)", border: "none",
                            cursor: "pointer", opacity: 0, transition: "opacity 0.15s ease",
                          }}
                        >
                          <X size={11} />
                        </button>

                        {/* Title */}
                        <p style={{
                          fontSize: 13, fontWeight: 600, color: "var(--text)",
                          lineHeight: 1.4, paddingRight: 24, marginBottom: 8,
                        }}>
                          {task.title}
                        </p>

                        {/* Tags row */}
                        <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap", marginBottom: 10 }}>
                          {/* Priority */}
                          <span style={{
                            fontSize: 9, fontWeight: 800, padding: "2px 6px", borderRadius: 20,
                            textTransform: "uppercase", letterSpacing: "0.04em",
                            background: PRIORITY_COLOR[task.priority] + "20",
                            color: PRIORITY_COLOR[task.priority],
                          }}>
                            {PRIORITY_LABEL[task.priority] ?? task.priority}
                          </span>
                          {/* Brand */}
                          {task.brand && (
                            <span style={{
                              fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 20,
                              background: task.brand.name === "Glowmmi" ? "#FCE7F3" : "#D1FAE5",
                              color: task.brand.name === "Glowmmi" ? "#BE185D" : "#065F46",
                            }}>
                              {task.brand.name}
                            </span>
                          )}
                          {/* Category */}
                          {task.category && (
                            <span style={{ fontSize: 10, color: "var(--text-3)" }}>{task.category}</span>
                          )}
                        </div>

                        {/* Move buttons */}
                        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                          {COLUMNS.filter((c) => c.key !== col.key).map((c) => (
                            <button
                              key={c.key}
                              onClick={() => moveTask(task.id, c.key)}
                              style={{
                                fontSize: 10, fontWeight: 600, padding: "3px 8px", borderRadius: 6,
                                background: c.bg, color: c.textColor,
                                border: `1px solid ${c.color}30`, cursor: "pointer",
                                whiteSpace: "nowrap",
                              }}
                            >
                              → {c.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}

                    {colTasks.length === 0 && adding !== col.key && (
                      <div style={{
                        padding: "32px 16px", textAlign: "center",
                        border: "2px dashed var(--border)", borderRadius: 12,
                        color: "var(--text-4)", fontSize: 12,
                      }}>
                        Sin tareas
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        .task-card:hover .task-delete { opacity: 1 !important; }
      `}</style>
    </div>
  );
}
