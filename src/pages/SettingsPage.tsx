import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import { signOut, updateProfile } from "../lib/queries";
import { IconSettings, IconLogout } from "../components/icons";

export default function SettingsPage() {
  const qc = useQueryClient();
  const me = useQuery({
    queryKey: ["me-full"],
    queryFn: async () => {
      const { data } = await supabase.auth.getUser();
      const uid = data.user?.id ?? "";
      const { data: prof } = await supabase.from("profiles").select("*").eq("id", uid).maybeSingle();
      const { data: profs } = await supabase.from("profiles").select("id");
      return { uid, prof, total: profs?.length ?? 0 };
    },
  });

  const [name, setName] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => updateProfile(me.data!.uid, { full_name: (name ?? me.data!.prof?.full_name ?? "").trim() }),
    onSuccess: () => {
      setMsg("Name saved.");
      qc.invalidateQueries({ queryKey: ["profiles"] });
    },
    onError: (e: Error) => setMsg(e.message),
  });

  if (me.isLoading) return <div className="page-loading"><span className="spinner" /> Loading settings…</div>;
  const prof = me.data?.prof;

  return (
    <>
      <div className="page-head">
        <div className="page-title">
          <div className="page-icon"><IconSettings size={22} /></div>
          <div>
            <h1>Settings</h1>
            <div className="page-sub">Your account. Roles are managed by the owner on the Users page.</div>
          </div>
        </div>
      </div>

      <div className="card" style={{ maxWidth: 560 }}>
        <div className="stat-row"><span className="s-label">Email</span><span className="s-value" style={{ fontSize: 14 }}>{prof?.email || "—"}</span></div>
        <div className="stat-row"><span className="s-label">Role</span><span className="s-value" style={{ fontSize: 14 }}>{prof?.role ?? "—"}</span></div>
        <label className="field" style={{ marginTop: 14 }}>
          Your name
          <input
            value={name ?? prof?.full_name ?? ""}
            placeholder="e.g. Chris Paolo Caral"
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
          <button className="primary" disabled={save.isPending} onClick={() => { setMsg(null); save.mutate(); }}>
            Save name
          </button>
          <button onClick={() => signOut()}> <IconLogout size={15} /> Sign out</button>
        </div>
        {msg && <div className="banner ok">{msg}</div>}
      </div>

      <div className="card" style={{ maxWidth: 560 }}>
        <div className="card-head">About</div>
        <div className="muted small" style={{ lineHeight: 1.9 }}>
          Material Control v1.0.0 · RORO Transport<br />
          Online database: Supabase, Singapore region<br />
          Weekly backup: use “Export (Google Sheets)” on the Purchases page — each export is kept as its own tab.
        </div>
      </div>
    </>
  );
}
