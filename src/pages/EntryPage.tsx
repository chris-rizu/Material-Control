import { useQuery } from "@tanstack/react-query";
import { fetchCategories, fetchSuppliers } from "../lib/queries";
import { useMe } from "../lib/useMe";
import InvoiceBlockEditor from "../components/InvoiceBlockEditor";

export default function EntryPage() {
  const cats = useQuery({ queryKey: ["categories"], queryFn: fetchCategories });
  const sups = useQuery({ queryKey: ["suppliers"], queryFn: fetchSuppliers });
  const me = useMe();

  if (cats.isLoading || sups.isLoading || me.isLoading) {
    return <div className="page-loading"><span className="spinner" /> Loading…</div>;
  }
  if (cats.error) return <div className="banner err">{String(cats.error)}</div>;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Encode <span className="accent">purchases</span></h1>
          <div className="page-sub">
            One invoice = date + SI# + supplier + its lines. The more you encode, the smarter
            the suggestions get.
          </div>
        </div>
      </div>
      <InvoiceBlockEditor
        categories={cats.data ?? []}
        suppliers={sups.data ?? []}
        userId={me.data?.id ?? ""}
      />
    </>
  );
}
