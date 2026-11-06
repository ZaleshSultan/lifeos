"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";

type Entry = { dirty: boolean; fields: Map<string, unknown> };
/** Private UI memory only: no browser storage, network, credentials or module singleton. */
export class DraftMemory {
  private entries = new Map<string, Entry>();
  private invalidated = false;
  read<T>(scope: string, field: string, initial: T | (() => T)): T {
    const entry = this.entries.get(scope);
    return entry?.dirty && entry.fields.has(field)
      ? (entry.fields.get(field) as T)
      : typeof initial === "function"
        ? (initial as () => T)()
        : initial;
  }
  write(scope: string, field: string, value: unknown) {
    if (this.invalidated) return;
    const entry = this.entries.get(scope) ?? {
      dirty: false,
      fields: new Map(),
    };
    entry.fields.set(field, value);
    this.entries.set(scope, entry);
  }
  retain(scope: string, dirty: boolean) {
    if (this.invalidated) return;
    if (!dirty) {
      // Keep the mounted form's base revision with its other fields. A later
      // edit may only change one field; restoring it must not pair it with a
      // newer server revision. Clean entries are ignored by read().
      const entry = this.entries.get(scope);
      if (entry) entry.dirty = false;
      return;
    }
    const entry = this.entries.get(scope) ?? { dirty, fields: new Map() };
    entry.dirty = true;
    this.entries.set(scope, entry);
  }
  clear() {
    this.entries.clear();
  }
  invalidate() {
    this.clear();
    this.invalidated = true;
  }
}
const Context = createContext<DraftMemory | null>(null);
export function DraftSessionProvider({
  owner,
  children,
}: {
  owner: number;
  children: ReactNode;
}) {
  const memory = useMemo(() => new DraftMemory(), [owner]);
  useEffect(() => {
    const clear = () => memory.invalidate();
    window.addEventListener("lifeos:session-rejected", clear);
    window.addEventListener("lifeos:signed-out", clear);
    return () => {
      memory.clear();
      window.removeEventListener("lifeos:session-rejected", clear);
      window.removeEventListener("lifeos:signed-out", clear);
    };
  }, [memory]);
  return (
    <Context.Provider key={owner} value={memory}>
      {children}
    </Context.Provider>
  );
}
/** Use only for editable UI fields and their optimistic revision; never credentials or consents. */
export function useDraftState<T>(
  scope: string,
  field: string,
  initial: T | (() => T),
): [T, Dispatch<SetStateAction<T>>] {
  const memory = useContext(Context);
  const resolveInitial = () =>
    memory
      ? memory.read(scope, field, initial)
      : typeof initial === "function"
        ? (initial as () => T)()
        : initial;
  const identity = `${scope}\u0000${field}`;
  const [state, setState] = useState(() => ({
    identity,
    value: resolveInitial(),
  }));
  const value = state.identity === identity ? state.value : resolveInitial();
  if (state.identity !== identity) setState({ identity, value });
  const latest = useRef(value);
  latest.current = value;
  const update = useCallback<Dispatch<SetStateAction<T>>>(
    (action) => {
      setState((previousState) => {
        const previous =
          previousState.identity === identity
            ? previousState.value
            : latest.current;
        const next =
          typeof action === "function"
            ? (action as (previous: T) => T)(previous)
            : action;
        memory?.write(scope, field, next);
        if (previousState.identity === identity && Object.is(previous, next))
          return previousState;
        return { identity, value: next };
      });
    },
    [memory, scope, field, identity],
  );
  useEffect(() => {
    memory?.write(scope, field, value);
  }, [memory, scope, field, value]);
  return [value, update];
}
/** Call once per form, after its fields. Clean/saved forms never mask fresh server values. */
export function useDraftRetention(scope: string, dirty: boolean): boolean {
  const memory = useContext(Context);
  useEffect(() => {
    memory?.retain(scope, dirty);
  }, [memory, scope, dirty]);
  return memory !== null;
}
export function useDiscardDraft(scope: string): () => void {
  const memory = useContext(Context);
  return useCallback(() => memory?.retain(scope, false), [memory, scope]);
}
/** Preserve retry identities without generating or sending an operation on navigation. */
export function useDraftRef<T>(
  scope: string,
  field: string,
  initial: T,
): { current: T } {
  const memory = useContext(Context);
  const ref = useMemo(
    () => ({ current: memory ? memory.read(scope, field, initial) : initial }),
    [memory, scope, field],
  );
  useEffect(
    () => () => {
      memory?.write(scope, field, ref.current);
    },
    [memory, scope, field, ref],
  );
  return ref;
}
