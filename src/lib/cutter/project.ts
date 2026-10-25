import type { CutOp } from "./types";

const DATABASE = "tool3d-cortador";
const STORE = "projects";
const KEY = "last";

export interface SavedProject {
  version: 1;
  id: string;
  name: string;
  savedAt: number;
  file: { name: string; type: string; bytes: ArrayBuffer };
  ops: CutOp[];
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE)) {
        database.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("No se pudo abrir el proyecto"));
  });
}

function runRequest<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return openDatabase().then(
    (database) =>
      new Promise<T>((resolve, reject) => {
        const transaction = database.transaction(STORE, mode);
        const request = action(transaction.objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () =>
          reject(request.error ?? new Error("Error de almacenamiento"));
        transaction.oncomplete = () => database.close();
        transaction.onerror = () => {
          database.close();
          reject(transaction.error ?? new Error("Error de almacenamiento"));
        };
      })
  );
}

export async function saveProject(
  name: string,
  file: File,
  ops: CutOp[]
): Promise<SavedProject> {
  const project: SavedProject = {
    version: 1,
    id: KEY,
    name,
    savedAt: Date.now(),
    file: {
      name: file.name,
      type: file.type,
      bytes: await file.arrayBuffer(),
    },
    ops,
  };
  await runRequest("readwrite", (store) => store.put(project));
  return project;
}

export async function loadProject(): Promise<SavedProject | null> {
  const result = await runRequest<SavedProject | undefined>(
    "readonly",
    (store) => store.get(KEY)
  );
  if (!result || result.version !== 1 || !Array.isArray(result.ops)) return null;
  return result;
}

export async function clearProject(): Promise<void> {
  await runRequest("readwrite", (store) => store.delete(KEY));
}
