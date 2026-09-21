/**
 * VaultStore: the single persistence boundary of VPIP.
 * Today it writes to IndexedDB in the browser. Swapping this file for a
 * real file-system implementation (Electron/Node) is the only change needed
 * to move the vault onto disk.
 */
const DB_NAME = "vpip-vault";
const STORE = "files";
const KEY = "workspace.json";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function vaultRead<T>(): Promise<T | null> {
  if (typeof indexedDB === "undefined") return null;
  const db = await open();
  return new Promise<T | null>((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(KEY);
    req.onsuccess = () => {
      const raw = req.result as string | undefined;
      resolve(raw ? (JSON.parse(raw) as T) : null);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function vaultWrite(value: unknown): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(JSON.stringify(value), KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function vaultSize(): Promise<number> {
  const raw = await vaultRead<unknown>();
  return raw ? new Blob([JSON.stringify(raw)]).size : 0;
}

export async function vaultClear(): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
