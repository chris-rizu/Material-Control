import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { signOut } from "../lib/queries";
import { applyTheme, getTheme, type Theme } from "../lib/theme";
import type { Profile } from "../lib/types";
import {
  IconInvoice, IconBox, IconTruck, IconReport, IconUpload,
  IconUsers, IconSettings, IconBell, IconChevronDown, IconLogout,
  IconMenu, IconSun, IconMoon, IconEye, IconHistory, IconReceipt,
} from "./icons";

function useDropdown<T extends HTMLElement>() {
  const [open, setOpen] = useState(false);
  const ref = useRef<T>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  return { open, setOpen, ref };
}

export default function Layout({ profile }: { profile: Profile | null }) {
  const navigate = useNavigate();
  const isOwner = profile?.role === "owner";
  const canWrite = profile?.role === "owner" || profile?.role === "encoder";
  const name = profile?.full_name || profile?.email?.split("@")[0] || "user";
  const initial = name.trim().charAt(0).toUpperCase();

  // minimized (icon-only) left menu — remembered between visits
  const [mini, setMini] = useState(() => {
    try { return localStorage.getItem("mc-side") === "mini"; } catch { return false; }
  });
  function toggleSide() {
    setMini((m) => {
      const next = !m;
      try { localStorage.setItem("mc-side", next ? "mini" : "full"); } catch { /* private mode */ }
      return next;
    });
  }

  // light / dark theme — remembered between visits
  const [theme, setTheme] = useState<Theme>(() => getTheme());
  function toggleTheme() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    applyTheme(next);
  }

  const bell = useDropdown<HTMLDivElement>();
  const user = useDropdown<HTMLDivElement>();

  const logoSrc = theme === "dark" ? "logo-dark.png" : "logo.png";

  return (
    <div className="shell">
      <aside className={"sidebar" + (mini ? " mini" : "")}>
        <div className="brand">
          <img className="brand-mark" src={logoSrc} alt="QUALI-T Builders Corp. logo" />
          <div>
            <div className="brand-name">Material Control</div>
            <div className="brand-sub">Purchases · Inventory · Made Simple</div>
          </div>
        </div>

        <div className="nav-label">Daily</div>
        <NavLink end className="nav-item" to="/" title="Purchases"><IconInvoice size={17} /> <span className="nav-text">Purchases</span></NavLink>
        <NavLink className="nav-item" to="/readonly" title="Read-Only"><IconEye size={17} /> <span className="nav-text">Read-Only</span></NavLink>
        {canWrite && <NavLink className="nav-item" to="/import" title="Import / Export"><IconUpload size={17} /> <span className="nav-text">Import / Export</span></NavLink>}

        <div className="nav-label">Catalog</div>
        <NavLink className="nav-item" to="/materials" title="Particulars"><IconBox size={17} /> <span className="nav-text">Particulars</span></NavLink>
        <NavLink className="nav-item" to="/suppliers" title="Suppliers"><IconTruck size={17} /> <span className="nav-text">Suppliers</span></NavLink>
        <NavLink className="nav-item" to="/receipts" title="Receipts"><IconReceipt size={17} /> <span className="nav-text">Receipts</span></NavLink>
        <NavLink className="nav-item" to="/reports" title="Reports"><IconReport size={17} /> <span className="nav-text">Reports</span></NavLink>
        <NavLink className="nav-item" to="/history" title="History"><IconHistory size={17} /> <span className="nav-text">History</span></NavLink>
        {isOwner && <NavLink className="nav-item" to="/admin" title="Users"><IconUsers size={17} /> <span className="nav-text">Users</span></NavLink>}
        <NavLink className="nav-item" to="/settings" title="Settings"><IconSettings size={17} /> <span className="nav-text">Settings</span></NavLink>

        <div className="side-foot">
          <div className="avatar">{initial}</div>
          <div className="who">
            <b>{name}</b>
            <span>{profile?.role}</span>
          </div>
          <button title="Sign out" onClick={() => signOut().then(() => navigate("/login"))}>
            <IconLogout size={16} />
          </button>
        </div>
      </aside>

      <div className="main-col">
        <header className="topbar">
          <button className="iconbtn" style={{ marginRight: "auto" }}
            title={mini ? "Expand menu" : "Minimize menu"} onClick={toggleSide}>
            <IconMenu size={20} />
          </button>
          <button className="iconbtn" title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            onClick={toggleTheme}>
            {theme === "dark" ? <IconSun size={19} /> : <IconMoon size={18} />}
          </button>
          <div style={{ position: "relative" }} ref={bell.ref}>
            <button className="iconbtn" onClick={() => bell.setOpen(!bell.open)} title="Notifications">
              <IconBell size={19} />
              <span className="dot" />
            </button>
            {bell.open && (
              <div className="menu">
                <div style={{ padding: "8px 10px", fontSize: 12.5, color: "var(--muted)" }}>
                  No new notifications. Imports and exports appear here soon.
                </div>
              </div>
            )}
          </div>

          <div style={{ position: "relative" }} ref={user.ref}>
            <button className="userchip" onClick={() => user.setOpen(!user.open)}>
              <div className="avatar">{initial}</div>
              <div>
                <div className="u-name">{name}</div>
                <div className="u-role">{profile?.role ?? ""}</div>
              </div>
              <IconChevronDown size={15} />
            </button>
            {user.open && (
              <div className="menu">
                <button className="mi" onClick={() => { user.setOpen(false); navigate("/settings"); }}>
                  <IconSettings size={16} /> Settings
                </button>
                <button className="mi" onClick={() => signOut().then(() => navigate("/login"))}>
                  <IconLogout size={16} /> Sign out
                </button>
              </div>
            )}
          </div>
        </header>

        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
