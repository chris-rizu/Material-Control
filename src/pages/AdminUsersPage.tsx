import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import { listProfiles, updateProfile } from "../lib/queries";
import { IconUsers } from "../components/icons";
import type { Role } from "../lib/types";

/** Owner-only: manage staff roles and active flag. */
export default function AdminUsersPage() {
  const qc = useQueryClient();
  const me = useQuery({
    queryKey: ["me"],
    queryFn: async () => (await supabase.auth.getUser()).data.user?.id ?? "",
  });
  const profiles = useQuery({ queryKey: ["profiles"], queryFn: listProfiles });

  const save = useMutation({
    mutationFn: (p: { id: string; patch: { role?: Role; is_active?: boolean } }) =>
      updateProfile(p.id, p.patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["profiles"] }),
  });

  return (
    <>
      <div className="page-head">
        <div className="page-title">
          <div className="page-icon"><IconUsers size={22} /></div>
          <div>
            <h1>Users</h1>
            <div className="page-sub">
              <b>owner</b> = everything · <b>encoder</b> = encode + import · <b>viewer</b> = read-only.
              New signups land as encoder. You cannot change your own role.
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        {profiles.isLoading ? (
          <div className="page-loading"><span className="spinner" /> Loading users…</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Email</th><th>Name</th><th>Role</th><th>Active</th><th>Created</th>
              </tr>
            </thead>
            <tbody>
              {(profiles.data ?? []).map((p) => {
                const isSelf = p.id === me.data;
                return (
                  <tr key={p.id}>
                    <td>{p.email || "—"}</td>
                    <td>{p.full_name || "—"}</td>
                    <td>
                      <select
                        value={p.role}
                        disabled={isSelf || save.isPending}
                        onChange={(e) => save.mutate({ id: p.id, patch: { role: e.target.value as Role } })}
                      >
                        <option value="owner">owner</option>
                        <option value="encoder">encoder</option>
                        <option value="viewer">viewer</option>
                      </select>
                    </td>
                    <td>
                      <input type="checkbox" checked={p.is_active} disabled={isSelf}
                        onChange={(e) => save.mutate({ id: p.id, patch: { is_active: e.target.checked } })} />
                    </td>
                    <td className="muted small">{p.created_at.slice(0, 10)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
