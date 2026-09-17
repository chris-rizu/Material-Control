// Receipt photo cache — makes a photo already be there when its SI# is clicked.
//
// Measured on the live app, every open used to cost a fresh signed URL
// (~170ms) plus a full re-download (0.5-1.1s) because each signed URL is a new
// address the browser can't cache. Instead:
//   - one authenticated download per photo (no signing round-trip),
//   - kept as a blob: URL in memory for the session,
//   - and in IndexedDB on this PC, so the next launch is instant too.
// Storage paths carry an upload timestamp and are never rewritten (a replaced
// photo gets a new path), so a cached photo can never go stale.
// Background preload fills the cache as soon as the receipts list loads.

import { supabase } from "./supabase";

const DB_NAME = "receipt-photos";
const STORE = "blobs";

const urls = new Map<string, string>(); // resolved blob: URLs
const pending = new Map<string, Promise<string>>();

let dbPromise: Promise<IDBDatabase | null> | null = null;
function openDb(): Promise<IDBDatabase | null> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      try {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null); // no IndexedDB — memory cache still works
      }
    });
  }
  return dbPromise;
}

async function idbGet(path: string): Promise<Blob | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).get(path);
      req.onsuccess = () => resolve(req.result instanceof Blob ? req.result : null);
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}

async function idbPut(path: string, blob: Blob): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try { db.transaction(STORE, "readwrite").objectStore(STORE).put(blob, path); } catch { /* cache only */ }
}

async function idbDelete(path: string): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try { db.transaction(STORE, "readwrite").objectStore(STORE).delete(path); } catch { /* cache only */ }
}

/** The photo's URL right now if it's already loaded, else null (no fetch). */
export function peekReceiptPhoto(path: string): string | null {
  return urls.get(path) ?? null;
}

/** A displayable URL for the photo — from memory, this PC's cache, or one download. */
export function loadReceiptPhoto(path: string): Promise<string> {
  const ready = urls.get(path);
  if (ready) return Promise.resolve(ready);
  const inflight = pending.get(path);
  if (inflight) return inflight;

  const p = (async () => {
    let blob = await idbGet(path);
    if (!blob) {
      const { data, error } = await supabase.storage.from("receipts").download(path);
      if (error || !data) throw error ?? new Error("The receipt photo couldn't be downloaded.");
      blob = data;
      void idbPut(path, blob);
    }
    const url = URL.createObjectURL(blob);
    urls.set(path, url);
    // decode ahead so the <img> paints on the same frame it mounts
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
    } catch { /* still displayable */ }
    return url;
  })();
  pending.set(path, p);
  p.then(() => pending.delete(path), () => pending.delete(path));
  return p;
}

/** Warm the cache for these photos in the background, a few at a time. */
export function preloadReceiptPhotos(paths: string[], concurrency = 4): void {
  const queue = paths.filter((p) => p && !urls.has(p) && !pending.has(p));
  if (!queue.length) return;
  let i = 0;
  const worker = async () => {
    while (i < queue.length) {
      const path = queue[i++];
      try { await loadReceiptPhoto(path); } catch { /* the viewer retries on open */ }
    }
  };
  for (let n = 0; n < Math.min(concurrency, queue.length); n++) void worker();
}

/** Drop a deleted/replaced photo from both caches. */
export function forgetReceiptPhoto(path: string): void {
  const url = urls.get(path);
  if (url) URL.revokeObjectURL(url);
  urls.delete(path);
  pending.delete(path);
  void idbDelete(path);
}
