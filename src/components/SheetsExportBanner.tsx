// Result line under an "Export to Google Sheets" button: success with a link
// back to the sheet (in case the browser didn't open), or the error.
export default function SheetsExportBanner({ result, onClose }: {
  result: { kind: "ok" | "err"; text: string; url?: string } | null;
  onClose: () => void;
}) {
  if (!result) return null;
  return (
    <div className={`banner ${result.kind}`} style={{ display: "flex", gap: 10, alignItems: "center" }}>
      <span style={{ flex: 1 }}>
        {result.text}
        {result.url && (
          <> <a href={result.url} target="_blank" rel="noreferrer">Open the sheet</a></>
        )}
      </span>
      <button className="ghost small" onClick={onClose} aria-label="Dismiss">×</button>
    </div>
  );
}
