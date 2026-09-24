export type LocalStore = Pick<Storage, 'getItem' | 'setItem'>;

export function browserStorage(): LocalStore | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export function readJson(storage: LocalStore | undefined, key: string): unknown {
  try {
    const value = storage?.getItem(key);
    return value ? JSON.parse(value) : undefined;
  } catch {
    return undefined;
  }
}

export function writeJson(storage: LocalStore | undefined, key: string, value: unknown): boolean {
  try {
    if (!storage) return false;
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
