import type { AttributeField } from "../lib/types";

interface Props {
  template: AttributeField[];
  values: Record<string, string | number>;
  onChange: (values: Record<string, string | number>) => void;
}

/**
 * The category-driven attribute form. Each category's attribute_template
 * decides which fields exist; a field with show_if only renders when the
 * referenced field's value contains one of the given words — this is how
 * DEGREES appears for elbows/bends and stays hidden for everything else.
 */
export default function CategoryForm({ template, values, onChange }: Props) {
  if (!template || template.length === 0) return null;

  function set(key: string, v: string | number) {
    onChange({ ...values, [key]: v });
  }

  function isVisible(f: AttributeField): boolean {
    if (!f.show_if) return true;
    const cur = String(values[f.show_if.field] ?? "").toUpperCase();
    return f.show_if.contains_any.some((w) => cur.includes(w.toUpperCase()));
  }

  return (
    <div className="line-grid">
      {template.filter(isVisible).map((f) => {
        const raw = values[f.key];
        const val = raw === undefined || raw === null ? "" : String(raw);
        return (
          <label className="field" key={f.key}>
            {f.label}{f.required ? " *" : ""}
            {f.widget === "select" ? (
              <select
                value={val}
                onChange={(e) => {
                  const v = e.target.value;
                  if (f.key === "degrees") set(f.key, v === "" ? 0 : Number(v));
                  else set(f.key, v);
                }}
              >
                <option value="">—</option>
                {(f.options ?? []).map((o) => (
                  <option key={String(o)} value={String(o)}>{String(o)}</option>
                ))}
              </select>
            ) : (
              <input
                value={val}
                placeholder={f.placeholder}
                onChange={(e) => set(f.key, e.target.value)}
              />
            )}
          </label>
        );
      })}
    </div>
  );
}

/** Does the given template contain a degrees-style conditional field? */
export function hasConditionalDegrees(template: AttributeField[]): boolean {
  return template.some((f) => f.show_if?.field === "type" && f.key === "degrees");
}
