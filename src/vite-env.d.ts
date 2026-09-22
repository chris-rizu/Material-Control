/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_SHEETS_EXPORT_URL?: string;
  readonly VITE_DRIVE_RECEIPT_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// injected by vite.config.ts from package.json
declare const __APP_VERSION__: string;
