import { useEffect, useRef, useState } from "react";
import { useHelp } from "./HelpContext";

export default function HelpMenu() {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const { chapters, openDoc, startTour, endTour, tourMode } = useHelp();

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    if (open) {
      document.addEventListener("mousedown", handleClick);
      document.addEventListener("keydown", handleEsc);
    }
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleEsc);
    };
  }, [open]);

  return (
    <div className="relative" ref={wrapRef} data-tour="help-menu">
      <button
        onClick={() => setOpen(!open)}
        aria-label="Aide"
        aria-haspopup="menu"
        aria-expanded={open}
        className="relative text-on-surface-variant hover:text-on-surface transition-colors flex items-center"
      >
        <span className="material-symbols-outlined text-2xl">help</span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-2 w-80 bg-surface-container-lowest rounded-xl shadow-lg z-50 overflow-hidden"
        >
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              if (tourMode) endTour();
              else startTour();
            }}
            className="w-full text-left px-4 py-3 hover:bg-surface-container transition-colors flex items-center gap-3"
          >
            <span className="material-symbols-outlined text-lg text-primary shrink-0">
              {tourMode ? "stop_circle" : "play_circle"}
            </span>
            <span className="text-sm font-bold text-on-surface">
              {tourMode ? "Terminer le tutoriel" : "Démarrer le tutoriel"}
            </span>
          </button>

          <div className="bg-surface-container-low px-4 py-2">
            <h3 className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">
              Documentation
            </h3>
          </div>

          <div className="max-h-80 overflow-y-auto">
            {chapters.map((c) => (
              <button
                key={c.id}
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  openDoc(c.id);
                }}
                className="w-full text-left px-4 py-2.5 hover:bg-surface-container transition-colors flex items-center gap-3"
              >
                <span className="material-symbols-outlined text-lg text-on-surface-variant shrink-0">
                  {c.icon}
                </span>
                <span className="text-sm text-on-surface min-w-0 flex-1 truncate">
                  {c.title}
                </span>
                {c.adminOnly && (
                  <span className="text-[9px] uppercase tracking-wider text-on-surface-variant shrink-0">
                    Admin
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
