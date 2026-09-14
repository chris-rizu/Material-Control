import { useEffect, useState } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import type { Session } from "@supabase/supabase-js";
import { supabase, isConfigured } from "./lib/supabase";
import { getProfile } from "./lib/queries";
import type { Profile } from "./lib/types";
import Layout from "./components/Layout";
import Guard from "./components/Guard";
import SetupPage from "./pages/SetupPage";
import LoginPage from "./pages/LoginPage";
import PurchasePage from "./pages/PurchasePage";
import EntryPage from "./pages/EntryPage";
import MaterialsPage from "./pages/MaterialsPage";
import SuppliersPage from "./pages/SuppliersPage";
import ReportsPage from "./pages/ReportsPage";
import ImportPage from "./pages/ImportPage";
import AdminUsersPage from "./pages/AdminUsersPage";
import SettingsPage from "./pages/SettingsPage";
import ReadOnlyPage from "./pages/ReadOnlyPage";
import HistoryPage from "./pages/HistoryPage";

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setSessionLoaded(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    // Wait for the stored session first: deciding "signed out" before it
    // loads bounced every reload through /login and back to Purchases.
    if (!sessionLoaded) return;
    let alive = true;
    (async () => {
      if (!session) {
        setProfile(null);
        setReady(true);
        return;
      }
      try {
        const p = await getProfile(session.user.id);
        if (alive) setProfile(p);
      } catch {
        if (alive) setProfile(null);
      } finally {
        if (alive) setReady(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [session]);

  if (!isConfigured) return <SetupPage />;
  if (!ready) return <div className="page-loading">Loading…</div>;

  return (
    <Routes>
      <Route path="/login" element={session ? <Navigate to="/" replace /> : <LoginPage />} />
      <Route element={<Guard session={session} profile={profile} />}>
        <Route element={<Layout profile={profile} />}>
          <Route path="/" element={<PurchasePage />} />
          <Route path="/ledger" element={<Navigate to="/" replace />} />
          <Route path="/readonly" element={<ReadOnlyPage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/entry" element={<Guard session={session} profile={profile} roles={["owner", "encoder"]}><EntryPage /></Guard>} />
          <Route path="/materials" element={<MaterialsPage />} />
          <Route path="/suppliers" element={<SuppliersPage />} />
          <Route path="/import" element={<Guard session={session} profile={profile} roles={["owner", "encoder"]}><ImportPage /></Guard>} />
          <Route path="/admin" element={<Guard session={session} profile={profile} roles={["owner"]}><AdminUsersPage /></Guard>} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
