// SI# box with a FIXED "SI#" prefix — the user types only the digits and the
// row saves the full "SI# <digits>" text. Blank is allowed: in the ledger a
// blank invoice cell means the line shares the receipt above it (it must NOT
// be treated as "no invoice" when the day + supplier match an earlier line).

interface Props {
  /** Digits only — the prefix lives in the UI, never in this value. */
  value: string;
  onChange: (digits: string) => void;
  onEnter?: () => void;
  placeholder?: string;
}

export default function SiInput({ value, onChange, onEnter, placeholder = "000000" }: Props) {
  return (
    <div className="si-box">
      <span className="si-prefix">SI#</span>
      <input
        inputMode="numeric"
        autoComplete="off"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 12))}
        onKeyDown={(e) => { if (e.key === "Enter") onEnter?.(); }}
        title="Type the invoice number only — the SI# prefix is fixed"
      />
    </div>
  );
}
