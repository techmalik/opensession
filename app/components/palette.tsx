// Cmd+K palette. Jumps to a submission, a speaker, or any organizer screen.
// Progressive enhancement only: everything it reaches is also a link in the sidebar,
// so a browser with no JavaScript loses a shortcut and nothing else.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { paletteScreens, type PaletteHit, type PaletteResults } from "../lib/palette";

interface Group {
  label: string;
  hits: PaletteHit[];
}

const EMPTY: PaletteResults = { sessions: [], speakers: [] };

export function CommandPalette({ base }: { base: string }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [remote, setRemote] = useState<PaletteResults>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const screens = useMemo(() => paletteScreens(base), [base]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setRemote(EMPTY);
    setCursor(0);
  }, []);

  // Global shortcut. Meta on macOS, Control elsewhere.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Debounced search. The request counter drops any response that arrives after a
  // newer one, so a slow query cannot overwrite a fresh result.
  const requestId = useRef(0);
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q.length < 2) {
      setRemote(EMPTY);
      setLoading(false);
      return;
    }
    const id = ++requestId.current;
    setLoading(true);
    const timer = setTimeout(() => {
      fetch(`${base}/palette.json?q=${encodeURIComponent(q)}`)
        .then((response) => (response.ok ? (response.json() as Promise<PaletteResults>) : EMPTY))
        .then((data) => {
          if (id !== requestId.current) return;
          setRemote(data);
          setLoading(false);
        })
        .catch(() => {
          if (id !== requestId.current) return;
          setRemote(EMPTY);
          setLoading(false);
        });
    }, 150);
    return () => clearTimeout(timer);
  }, [query, open, base]);

  const groups: Group[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = q
      ? screens.filter((screen) => screen.label.toLowerCase().includes(q) || screen.hint.toLowerCase().includes(q))
      : screens;
    const out: Group[] = [];
    if (remote.sessions.length > 0) out.push({ label: "Submissions", hits: remote.sessions });
    if (remote.speakers.length > 0) out.push({ label: "Speakers", hits: remote.speakers });
    if (matched.length > 0) out.push({ label: "Screens", hits: matched.slice(0, q ? 8 : screens.length) });
    return out;
  }, [screens, remote, query]);

  const flat = useMemo(() => groups.flatMap((group) => group.hits), [groups]);

  useEffect(() => {
    setCursor(0);
  }, [query, remote]);

  // Keep the highlighted row inside the scroll box when the arrows walk past its edge.
  useEffect(() => {
    const node = listRef.current?.querySelector<HTMLElement>(`[data-index="${cursor}"]`);
    node?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  const go = (to: string) => {
    close();
    navigate(to);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setCursor((prev) => (flat.length === 0 ? 0 : (prev + 1) % flat.length));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setCursor((prev) => (flat.length === 0 ? 0 : (prev - 1 + flat.length) % flat.length));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const hit = flat[cursor];
      if (hit) go(hit.to);
    }
  };

  let index = -1;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-between rounded-md border border-slate-200 px-2 py-1.5 text-[13px] text-slate-500 hover:bg-slate-50"
      >
        <span>Search</span>
        <span className="font-mono text-xs text-slate-400">Cmd K</span>
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/20 p-4 pt-[10vh]">
          {/* Click-away. A plain sibling rather than a wrapper, so the card is not
              nested inside a clickable region. */}
          <div className="absolute inset-0" onClick={close} aria-hidden="true" />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Search"
            onKeyDown={onKeyDown}
            className="relative w-full max-w-[560px] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm"
          >
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search submissions, speakers, and screens"
              aria-label="Search submissions, speakers, and screens"
              className="h-11 w-full border-b border-slate-200 px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none"
            />
            <ul ref={listRef} className="max-h-[320px] overflow-y-auto py-1">
              {flat.length === 0 ? (
                <li className="px-3 py-3 text-[13px] text-slate-500">
                  {loading ? "Searching" : query.trim() ? "No matches." : "Type to search."}
                </li>
              ) : (
                groups.map((group) => (
                  <li key={group.label}>
                    <p className="px-3 pb-1 pt-2 text-xs font-medium tracking-wide text-slate-400">{group.label}</p>
                    <ul>
                      {group.hits.map((hit) => {
                        index += 1;
                        const current = index;
                        return (
                          <li key={`${group.label}-${hit.to}-${hit.label}`}>
                            <button
                              type="button"
                              data-index={current}
                              onMouseEnter={() => setCursor(current)}
                              onClick={() => go(hit.to)}
                              className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-[13px] ${
                                current === cursor ? "bg-slate-50" : ""
                              }`}
                            >
                              <span className="truncate font-medium text-slate-900">{hit.label}</span>
                              <span className="shrink-0 truncate text-xs text-slate-500">{hit.hint}</span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                ))
              )}
            </ul>
            <div className="flex items-center gap-3 border-t border-slate-200 px-3 py-2 text-xs text-slate-400">
              <span>Up and down to move</span>
              <span>Enter to open</span>
              <span>Esc to close</span>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
