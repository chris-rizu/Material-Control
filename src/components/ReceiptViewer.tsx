// ReceiptViewer — the photo preview modal shared by the Purchases and
// Read-Only ledgers (and the Receipts tab). Photos come from the receipt
// photo cache (lib/receiptPhotos): preloaded photos open on the same frame,
// anything else is downloaded once and kept.

import { useEffect, useRef, useState } from "react";
import { loadReceiptPhoto, peekReceiptPhoto } from "../lib/receiptPhotos";
import type { Receipt } from "../lib/types";
import { IconX } from "./icons";

export default function ReceiptViewer({
  receipt, onClose,
}: {
  receipt: Receipt | null;
  onClose: () => void;
}) {
  const path = receipt?.storage_path ?? "";
  const [url, setUrl] = useState<string | null>(() => (path ? peekReceiptPhoto(path) : null));
  const [err, setErr] = useState("");
  // parents pass an inline onClose — keep the latest without re-running the load
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    setErr("");
    if (!path) { setUrl(null); return; }
    setUrl(peekReceiptPhoto(path));
    let alive = true;
    loadReceiptPhoto(path)
      .then((u) => { if (alive) setUrl(u); })
      .catch((e: Error) => { if (alive) setErr(e.message || String(e)); });
    const onKey = (ev: KeyboardEvent) => ev.key === "Escape" && closeRef.current();
    document.addEventListener("keydown", onKey);
    return () => {
      alive = false;
      document.removeEventListener("keydown", onKey);
    };
  }, [path]);

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
