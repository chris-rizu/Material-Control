import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ensureSupplier, fetchSuppliers } from "../lib/queries";
import { IconTruck } from "../components/icons";

export default function SuppliersPage() {
  const qc = useQueryClient();
  const sups = useQuery({ queryKey: ["suppliers"], queryFn: fetchSuppliers });
  const [name, setName] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const add = useMutation({
    mutationFn: () => ensureSupplier(name.trim()),
    onSuccess: (s) => {
      setMsg(`Supplier ready: ${s.name}`);
      setName("");
      qc.invalidateQueries({ queryKey: ["suppliers"] });
    },
    onError: (e: Error) => setMsg(e.message),
  });

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Suppliers</h1>
          <div className="page-sub">
            The hardware stores and stations you buy from. New ones are created automatically
            while encoding or importing.
          </div>
        </div>
      </div>

      <div className="card">
        <div className="row">
          <label className="field grow">
            Add supplier
            <input value={name} placeholder="e.g. CEBU LUCKY MACHINERY, INC."
              onChange={(e) => setName(e.target.value)} />
          </label>
          <button className="primary" disabled={!name.trim() || add.isPending}
            onClick={() => { setMsg(null); add.mutate(); }}>
            Add
          </button>
        </div>
        {msg && <div className="banner ok">{msg}</div>}
      </div>

      <div className="card">
        {(sups.data ?? []).length === 0 ? (
          <div className="empty">
            <IconTruck size={40} />
            <div className="e-title">No suppliers yet</div>
            <div>They appear automatically when you encode or import purchases.</div>
          </div>
        ) : (
          <table>
            <thead>
              <tr><th>Name ({(sups.data ?? []).length})</th></tr>
            </thead>
            <tbody>
              {(sups.data ?? []).map((s) => (
                <tr key={s.id}><td>{s.name}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
