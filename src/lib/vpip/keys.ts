import { useCallback, useEffect, useState } from "react";
import type { ProviderId } from "./types";

export type KeyStatus = Record<ProviderId, boolean>;

const EMPTY: KeyStatus = {
  openai: false,
  deepseek: false,
  perplexity: false,
  Gemini: false,
  Claude: false,
};

let cache: Promise<KeyStatus> | null = null;

export function fetchKeyStatus(force = false): Promise<KeyStatus> {
  if (!cache || force) {
    cache = fetch("/api/ai/status")
      .then((r) => (r.ok ? (r.json() as Promise<KeyStatus>) : EMPTY))
      .catch(() => EMPTY);
  }
  return cache;
}

/** Which provider keys are configured on the server (the browser never sees them). */
export function useAiKeys() {
  const [keys, setKeys] = useState<KeyStatus>(EMPTY);

  const refresh = useCallback(() => {
    void fetchKeyStatus(true).then(setKeys);
  }, []);

  useEffect(() => {
    let alive = true;
    void fetchKeyStatus().then((k) => {
      if (alive) setKeys(k);
    });
    return () => {
      alive = false;
    };
  }, []);

  return { keys, refresh };
}
