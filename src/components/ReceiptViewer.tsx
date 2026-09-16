// ReceiptViewer — the photo preview modal shared by the Purchases and
// Read-Only ledgers (and the Receipts tab). Signing is per-open: the bucket
// is private, so every view mints a fresh one-hour signed URL.

import { useEffect, useState } from "react";
import { signReceiptUrl } from "../lib/queries";
import type { Receipt } from "../lib/types";
import { IconX } from "./icons";

export default function ReceiptViewer({
  receipt, onClose,
}: {
  receipt: Receipt | null;
  onClose: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    setUrl(null);
    setErr("");
    if (!receipt) return;
    let alive = true;
    signReceiptUrl(receipt.storage_path)
      .then((u) => { if (alive) setUrl(u); })
      .catch((e: Error) => { if (alive) setErr(e.message || String(e)); });
    const onKey = (ev: KeyboardEvent) => ev.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => {
      alive = false;
      document.removeEventListener("keydown", onKey);
    };
  }, [receipt, onClose]);

  if (!receipt) return null;
  return (
    <div className="modal" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="rv-cap">
          <b>{receipt.si_no || "No invoice #"}</b>
          <span className="muted">{receipt.purchase_date} · receipt photo</span>
          <button className="iconbtn" title="Close (Esc)" onClick={onClose}>
            <IconX size={16} />
          </button>
        </div>
        {err ? (
          <div className="banner err" style={{ margin: 14 }}>{err}</div>
        ) : !url ? (
          <div className="rv-loading"><span className="spinner" /> Opening receipt…</div>
        ) : (
          <img
            className="rv-img"
            src={url}
            alt={`Receipt ${receipt.si_no || receipt.purchase_date}`}
          />
        )}
      </div>
    </div>
  );
}
