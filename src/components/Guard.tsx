import { Navigate, Outlet } from "react-router-dom";
import type { ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import type { Profile } from "../lib/types";

interface GuardProps {
  session: Session | null;
  profile: Profile | null;
  /** When given, the signed-in user's role must be one of these. */
  roles?: ("owner" | "encoder" | "viewer")[];
  children?: ReactNode;
}

/** Route guard: requires login; optionally restricts by role. */
export default function Guard({ session, profile, roles, children }: GuardProps) {
  if (!session) return <Navigate to="/login" replace />;
  if (roles && profile && !roles.includes(profile.role)) {
    return (
      <div className="container">
        <div className="banner err">
          Your account ({profile.role}) is not allowed on this page. Ask the owner for access.
        </div>
      </div>
    );
  }
  return children ?? <Outlet />;
}
