import { useHelp } from "./HelpContext";

/** Visible tant que le tutoriel n'a pas été suivi et que le mode n'est pas
 *  actif (le bandeau prend alors le relais). Une fois le tutoriel terminé, il
 *  reste accessible depuis le menu « ? ». */
export default function StartTourButton() {
  const { tourSeen, tourMode, startTour } = useHelp();

  if (tourSeen || tourMode) return null;

  return (
    <button
      onClick={startTour}
      className="bg-primary text-on-primary rounded-xl px-3 py-1.5 text-xs font-bold inline-flex items-center gap-1.5 shrink-0"
      title="Démarrer le tutoriel"
    >
      <span className="material-symbols-outlined text-lg">play_circle</span>
      <span className="hidden sm:inline">Tutoriel</span>
    </button>
  );
}
