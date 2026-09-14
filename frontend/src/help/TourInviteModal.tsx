import { useEffect, useRef } from "react";
import { useHelp } from "./HelpContext";

export default function TourInviteModal() {
  const { inviteOpen, startTour, dismissInvite } = useHelp();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!inviteOpen) return;
    ref.current?.focus();
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismissInvite();
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [inviteOpen, dismissInvite]);

  if (!inviteOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-on-surface/40" onClick={dismissInvite} />
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Découvrir l'application"
        className="relative bg-surface rounded-2xl shadow-2xl w-full max-w-md p-6 focus:outline-none"
      >
        <div className="flex items-center gap-3 mb-3">
          <span className="material-symbols-outlined text-primary text-2xl">
            explore
          </span>
          <h2 className="font-headline font-bold text-on-surface text-base">
            Découvrir l'application
          </h2>
        </div>
        <p className="text-sm text-on-surface-variant mb-5">
          En mode tutoriel, chaque écran que vous ouvrez vous est expliqué. Vous
          naviguez librement et vous y mettez fin quand vous le souhaitez, depuis
          le bandeau en haut de page.
        </p>
        <div className="flex items-center gap-2">
          <button
            onClick={dismissInvite}
            className="px-4 py-2 rounded-xl text-sm font-bold text-on-surface-variant hover:bg-surface-container transition-colors"
          >
            Plus tard
          </button>
          <div className="flex-1" />
          <button
            onClick={() => {
              dismissInvite();
              startTour();
            }}
            className="px-4 py-2 bg-primary text-on-primary rounded-xl text-sm font-bold inline-flex items-center gap-2"
          >
            <span className="material-symbols-outlined text-lg">play_circle</span>
            Démarrer le tutoriel
          </button>
        </div>
      </div>
    </div>
  );
}
