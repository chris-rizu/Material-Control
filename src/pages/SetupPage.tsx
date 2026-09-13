// Shown until .env holds the Supabase credentials — beginner-safe setup steps.

export default function SetupPage() {
  return (
    <div style={{ maxWidth: 860, margin: "0 auto", padding: "44px 18px 60px" }}>
      <div className="page-head">
        <div>
          <h1>Material Control — <span className="accent">first-time setup</span></h1>
          <div className="page-sub">
            The app runs, but it needs your free Supabase database. About 5 minutes, once.
          </div>
        </div>
      </div>

      <div className="card">
        <h2>1 · Create the database project</h2>
        <ol style={{ margin: 0, paddingLeft: 20, lineHeight: 1.9 }}>
          <li>Go to <b>supabase.com</b> → sign up / sign in (free).</li>
          <li><b>New project</b> · name: <code>material-control</code> · region: <b>Southeast Asia (Singapore)</b> · generate a database password and save it somewhere safe (the app itself never uses it).</li>
          <li>Wait ~2 minutes for it to finish provisioning.</li>
        </ol>
      </div>

      <div className="card">
        <h2>2 · Create the tables (one paste)</h2>
        <ol style={{ margin: 0, paddingLeft: 20, lineHeight: 1.9 }}>
          <li>In your project: <b>SQL Editor</b> → <b>New query</b>.</li>
          <li>Open <code>material-control-app\supabase\schema.sql</code> in Notepad, copy <b>everything</b>, paste into the query box, click <b>Run</b>.</li>
          <li>You should see “Success. No rows returned”. This creates the tables, security rules, the predictive search, and seeds the 10 categories + your 15 suppliers.</li>
        </ol>
      </div>

      <div className="card">
        <h2>3 · Allow email login</h2>
        <ol style={{ margin: 0, paddingLeft: 20, lineHeight: 1.9 }}>
          <li><b>Authentication</b> → <b>Sign In / Providers</b> → <b>Email</b> is enabled by default.</li>
          <li>Expand Email → turn <b>OFF</b> “Confirm email” (the team logs in with dashboard-created accounts).</li>
        </ol>
      </div>

      <div className="card">
        <h2>4 · Create the users</h2>
        <ol style={{ margin: 0, paddingLeft: 20, lineHeight: 1.9 }}>
          <li><b>Authentication</b> → <b>Users</b> → <b>Add user</b> → set an email + password, tick <b>Auto confirm</b>.</li>
          <li>The <b>first</b> user you create becomes the <b>owner</b>; the rest become encoders (changeable later in the app’s Users page).</li>
        </ol>
      </div>

      <div className="card">
        <h2>5 · Connect this app</h2>
        <ol style={{ margin: 0, paddingLeft: 20, lineHeight: 1.9 }}>
          <li><b>Project Settings</b> (gear icon) → <b>API</b>.</li>
          <li>Copy <b>Project URL</b> and the <b>anon public</b> key (NOT the service_role key).</li>
          <li>In <code>material-control-app</code>, create a file named <code>.env</code> with both values:</li>
        </ol>
        <pre style={{ margin: "10px 0" }}>
{`VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...your-anon-key`}
        </pre>
        <ol start={4} style={{ margin: 0, paddingLeft: 20, lineHeight: 1.9 }}>
          <li>Stop the dev server (Ctrl+C) and start it again: <code>npm run dev</code>.</li>
        </ol>
      </div>

      <p className="muted small">
        After that, sign in on the login page. Then go to <b>Import</b> to bring in
        PURCHASES (1).xlsx — the app shows every repair it makes before writing anything.
      </p>
    </div>
  );
}
