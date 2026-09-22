// History — the activity log: every insert / update / delete / restore that
// happened to purchases, suppliers and particulars, newest first. Deleted
// purchase lines (and suppliers/particulars) can be put back with one click.

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchActivity, restoreActivity } from "../lib/queries";
import { useMe } from "../lib/useMe";
import { IconHistory, IconUndo } from "../components/icons";
import type { ActivityEntry } from "../lib/types";

const PAGE = 100;

function relTime(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
}

const TABLE_LABEL: Record<string, string> = {
  purchases: "Purchase",
  suppliers: "Supplier",
  materials: "Particular",
  receipts: "Receipt",
  categories: "Category",
  projects: "Project",
};

const ACTION_LABEL: Record<ActivityEntry["action"], string> = {
  insert: "Added",
  update: "Edited",
  delete: "Deleted",
  restore: "Restored",
};

export default function HistoryPage() {
  const qc = useQueryClient();
  const [offset, setOffset] = useState(0);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [restoringId, setRestoringId] = useState<number | null>(null);

  const me = useMe();
  const canRestore = me.data?.role === "owner" || me.data?.role === "encoder";

  const log = useQuery({
    queryKey: ["activity", offset],
    queryFn: () => fetchActivity(PAGE, offset),
  });

  const restore = useMutation({
    mutationFn: (logId: number) => restoreActivity(logId),
    onSuccess: (text) => {
      setMsg({ kind: "ok", text });
      setRestoringId(null);
      qc.invalidateQueries({ queryKey: ["ledger"] });
      qc.invalidateQueries({ queryKey: ["suppliers"] });
      qc.invalidateQueries({ queryKey: ["materials"] });
      qc.invalidateQueries({ queryKey: ["activity"] });
    },
    onError: (e: Error) => {
      setMsg({ kind: "err", text: e.message });
      setRestoringId(null);
    },
  });

  const entries = log.data ?? [];
  const mightHaveMore = entries.length === PAGE; // a short page means we hit the end

  if (log.isLoading || me.isLoading) {
    return <div className="page-loading"><span className="spinner" /> Loading history…</div>;
  }
  if (log.error) return <div className="banner err">{String(log.error)}</div>;

  return (
    <>
      <div className="page-head">
        <div className="page-title">
          <div className="page-icon"><IconHistory size={22} /></div>
          <div>
            <h1>History</h1>
            <div className="page-sub">
              Recent activity across the ledger. A deleted line can be put back with Restore.
            </div>
          </div>
        </div>
      </div>

      {msg && <div className={`banner ${msg.kind}`}>{msg.text}</div>}

      <div className="card">
        {entries.length === 0 ? (
          <div className="empty">
            <IconHistory size={40} />
            <div className="e-title">Nothing logged yet</div>
            <div>Every add, edit and delete will be recorded here from now on.</div>
          </div>
        ) : (
          <div className="hist-list">
            {entries.map((e) => (
              <div className="hist-row" key={e.id}>
                <span className={`chip ${
                  e.action === "insert" ? "brand"
                    : e.action === "delete" ? "bad"
                    : e.action === "restore" ? "ok"
                    : "warn"
                }`}>
                  {ACTION_LABEL[e.action] ?? e.action}
                </span>
                <div className="hist-main">
                  <div className="hist-summary">{e.summary}</div>
                  <div className="hist-sub">
                    {TABLE_LABEL[e.table_name] ?? e.table_name}
                    {" · "}
                    {(e.actor || "someone")}
                    {" · "}
                    {new Date(e.acted_at).toLocaleString("en-PH", {
                      month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
                    })}
                  </div>
                </div>
                <span className="hist-when">{relTime(e.acted_at)}</span>
                {/* restore re-inserts the exact old row — only purchase lines
                    are restorable; the rest are logged for the record */}
                {canRestore && e.action === "delete" && e.table_name === "purchases" && (
                  <button
                    className="hist-restore"
                    disabled={restore.isPending}
                    title="Put this deleted row back"
                    onClick={() => {
                      if (confirm(`Restore this deleted ${TABLE_LABEL[e.table_name] ?? "row"}?\n\n${e.summary}`)) {
                        setRestoringId(e.id);
                        restore.mutate(e.id);
                      }
                    }}
                  >
                    {restoringId === e.id ? <span className="spinner" /> : <><IconUndo size={14} /> Restore</>}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        {(offset > 0 || mightHaveMore) && (
          <div className="hist-pager">
            <button onClick={() => setOffset((o) => Math.max(o - PAGE, 0))} disabled={offset === 0 || log.isFetching}>
              ← Newer
            </button>
            <span className="muted small">
              {offset + 1}–{offset + entries.length}
            </span>
            <button onClick={() => setOffset((o) => o + PAGE)} disabled={!mightHaveMore || log.isFetching}>
              Older →
            </button>
          </div>
        )}
      </div>
    </>
  );
}
