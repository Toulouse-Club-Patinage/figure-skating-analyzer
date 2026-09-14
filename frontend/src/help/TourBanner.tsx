import { useHelp } from "./HelpContext";

/** Rappelle en permanence que le mode tutoriel est actif, et porte le seul
 *  bouton qui en sort. Placé dans le flux sous la barre supérieure : un bandeau
 *  qui recouvrirait l'écran qu'il prétend expliquer serait absurde. */
export default function TourBanner() {
  const { tourMode, endTour } = useHelp();

  if (!tourMode) return null;

  return (
    <div
      role="status"
      className="sticky top-[72px] z-20 bg-primary text-on-primary px-4 lg:px-8 py-2.5 flex items-center gap-3"
    >
      <span className="material-symbols-outlined text-xl shrink-0">school</span>
      <p className="text-xs font-medium flex-1 min-w-0 hidden sm:block">
        Mode tutoriel — les écrans que vous ouvrez vous sont expliqués.
      </p>
      <p className="text-xs font-medium flex-1 min-w-0 sm:hidden">
        Mode tutoriel
      </p>
      <button
        onClick={endTour}
        className="bg-on-primary text-primary rounded-xl px-3 py-1.5 text-xs font-bold shrink-0"
      >
        Terminer le tutoriel
      </button>
    </div>
  );
}
