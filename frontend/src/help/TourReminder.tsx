import { useHelp } from "./HelpContext";

/** Visible quand le mode est actif mais qu'aucune explication n'est à l'écran :
 *  dit où l'on en est, et permet de rejouer un écran cliqué trop vite. */
export default function TourReminder() {
  const { tourMode, overlayVisible, hasStepsHere, replayScreen, currentScreenLabel } =
    useHelp();

  if (!tourMode || overlayVisible) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[55] bg-surface-container-lowest rounded-2xl shadow-lg px-4 py-3 max-w-xs">
      <div className="flex items-center gap-2 mb-1">
        <span className="material-symbols-outlined text-primary text-lg">
          school
        </span>
        <span className="text-xs font-bold text-on-surface">Tutoriel actif</span>
      </div>
      <p className="text-xs text-on-surface-variant">
        Ouvrez une autre section pour la découvrir.
      </p>
      {hasStepsHere && (
        <button
          onClick={replayScreen}
          className="text-xs text-primary hover:underline mt-2 inline-flex items-center gap-1"
        >
          <span className="material-symbols-outlined text-sm">replay</span>
          Revoir {currentScreenLabel}
        </button>
      )}
    </div>
  );
}
