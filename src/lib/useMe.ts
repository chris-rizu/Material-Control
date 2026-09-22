// One canonical "me" query for every page. It used to be defined per page and
// two shapes were cached under the same ["me"] key — a bare uuid on the import
// and entry pages, {id, role} everywhere else — so whichever page's query
// resolved last won, and the import once wrote a whole profile OBJECT into the
// uuid column created_by ("invalid input syntax for type uuid"). Every page
// now shares this hook: { id, role }.

import { useQuery } from "@tanstack/react-query";
import { supabase } from "./supabase";

export interface Me {
  id: string;
  role: string;
}

export function useMe() {
  return useQuery<Me>({
    queryKey: ["me"],
    queryFn: async () => {
      const { data } = await supabase.auth.getUser();
      const pid = data.user?.id ?? "";
      if (!pid) return { id: "", role: "viewer" };
      const { data: prof } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", pid)
        .maybeSingle();
      return { id: pid, role: prof?.role ?? "viewer" };
    },
  });
}
