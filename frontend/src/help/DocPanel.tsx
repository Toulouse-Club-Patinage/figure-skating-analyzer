import { useEffect, useRef } from "react";
import { useHelp } from "./HelpContext";

export default function DocPanel() {
  const { chapters, docChapterId, openDoc, closeDoc } = useHelp();
  const panelRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  const index = chapters.findIndex((c) => c.id === docChapterId);
  const chapter = index >= 0 ? chapters[index] : null;

  useEffect(() => {
    if (!chapter) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeDoc();
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [chapter, closeDoc]);

  // Le panneau prend le focus à l'ouverture, et le contenu repart du haut à
  // chaque changement de chapitre.
  useEffect(() => {
    if (chapter) {
      panelRef.current?.focus();
      bodyRef.current?.scrollTo(0, 0);
    }
  }, [chapter]);

  if (!chapter) return null;

  const previous = index > 0 ? chapters[index - 1] : null;
  const next = index < chapters.length - 1 ? chapters[index + 1] : null;

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-on-surface/40" onClick={closeDoc} />
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={`Documentation : ${chapter.title}`}
        className="absolute right-0 top-0 h-full w-full max-w-xl bg-surface-container-lowest shadow-2xl flex flex-col focus:outline-none"
      >
        <header className="flex items-center gap-3 px-5 py-4 bg-surface-container-low shrink-0">
          <span className="material-symbols-outlined text-primary text-xl">
            {chapter.icon}
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="font-headline font-bold text-on-surface text-base truncate">
              {chapter.title}
            </h2>
            {chapter.adminOnly && (
              <span className="text-[10px] uppercase tracking-wider text-on-surface-variant">
                Administrateur
              </span>
            )}
          </div>
          <button
            onClick={closeDoc}
            aria-label="Fermer la documentation"
            className="w-8 h-8 rounded-full bg-surface-container flex items-center justify-center text-on-surface-variant hover:text-on-surface transition-colors shrink-0"
          >
            <span className="material-symbols-outlined text-lg">close</span>
          </button>
        </header>

        <div ref={bodyRef} className="flex-1 overflow-y-auto px-5 py-4">
          {chapter.body()}
        </div>

        <nav className="flex items-center justify-between gap-2 px-5 py-3 bg-surface-container-low shrink-0">
          {previous ? (
            <button
              onClick={() => openDoc(previous.id)}
              className="flex items-center gap-1 text-xs text-primary hover:underline min-w-0"
            >
              <span className="material-symbols-outlined text-base shrink-0">
                chevron_left
              </span>
              <span className="truncate">{previous.title}</span>
            </button>
          ) : (
            <span />
          )}
          {next && (
            <button
              onClick={() => openDoc(next.id)}
              className="flex items-center gap-1 text-xs text-primary hover:underline min-w-0"
            >
              <span className="truncate">{next.title}</span>
              <span className="material-symbols-outlined text-base shrink-0">
                chevron_right
              </span>
            </button>
          )}
        </nav>
      </div>
    </div>
  );
}
