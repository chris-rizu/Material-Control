import { useState } from "react";
import { signIn } from "../lib/queries";
import { getTheme } from "../lib/theme";

export default function LoginPage() {
  // dark chrome → light-line logo; light chrome → the original full-color logo
  const [logoSrc] = useState(() => (getTheme() === "dark" ? "logo-dark.svg" : "logo.png"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await signIn(email.trim(), password);
    setBusy(false);
    if (error) setError(error.message);
  }

  return (
    <div className="login-shell">
      <div className="login-card">
        <div className="brand">
          <img className="brand-mark" src={logoSrc} alt="Material Control logo" />
          <div>
            <div className="brand-name">Material Control</div>
            <div className="brand-sub">RORO TRANSPORT · CEBU</div>
          </div>
        </div>

        <form onSubmit={submit}>
          <label className="field">
            Email
            <input type="email" value={email} required autoComplete="username"
              placeholder="you@company.com"
              onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="field" style={{ marginTop: 12 }}>
            Password
            <input type="password" value={password} required autoComplete="current-password"
              placeholder="••••••••"
              onChange={(e) => setPassword(e.target.value)} />
          </label>
          <button className="primary" type="submit" disabled={busy}
            style={{ marginTop: 18, width: "100%", justifyContent: "center" }}>
            {busy ? <span className="spinner" style={{ borderTopColor: "#fff" }} /> : null}
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
        {error && <div className="banner err login-error">{error}</div>}
        <p className="muted small" style={{ marginTop: 16, marginBottom: 0 }}>
          Accounts are created by the owner in Supabase — the first one is the owner.
        </p>
      </div>
    </div>
  );
}
