import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLocation } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { chaptersFor, type Audience, type Chapter } from "./content";
import { screenPatternFor, screenTourFor, type TourStep } from "./tour";

interface HelpState {
  audience: Audience;
  chapters: Chapter[];
  docChapterId: string | null;
  openDoc: (chapterId?: string) => void;
  closeDoc: () => void;
  tourMode: boolean;
  startTour: () => void;
  endTour: () => void;
  steps: TourStep[];
  stepIndex: number;
  overlayVisible: boolean;
  nextStep: () => void;
  prevStep: () => void;
  closeOverlay: () => void;
  replayScreen: () => void;
  currentScreenLabel: string | null;
  hasStepsHere: boolean;
  tourSeen: boolean;
  inviteOpen: boolean;
  dismissInvite: () => void;
}

const HelpContext = createContext<HelpState | null>(null);

const INVITE_DISMISSED_KEY = "tutorial_invite_dismissed";
const SCREENS_SEEN_KEY = "tutorial_screens_seen";
const TOUR_MODE_KEY = "tutorial_mode_active";

function readSeenScreens(): string[] {
  try {
    const raw = localStorage.getItem(SCREENS_SEEN_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function writeSeenScreens(patterns: string[]) {
  try {
    localStorage.setItem(SCREENS_SEEN_KEY, JSON.stringify(patterns));
  } catch {
    // Navigation privée ou stockage plein : le tutoriel refera l'écran au
    // rechargement, ce qui est sans gravité.
  }
}

export function HelpProvider({
  passwordModalOpen,
  children,
}: {
  /** Le modal de mot de passe est-il à l'écran ? L'invite du tutoriel attend
   *  qu'il soit fermé, quelle qu'en soit l'issue : un compte créé par demande
   *  arrive justement avec un mot de passe temporaire ET une première
   *  connexion. */
  passwordModalOpen: boolean;
  children: ReactNode;
}) {
  const { user, updateUser } = useAuth();
  const { pathname } = useLocation();

  const [docChapterId, setDocChapterId] = useState<string | null>(null);
  const [tourMode, setTourMode] = useState(
    () => sessionStorage.getItem(TOUR_MODE_KEY) === "true"
  );
  const [steps, setSteps] = useState<TourStep[]>([]);
  const [stepIndex, setStepIndex] = useState(0);
  const [inviteDismissed, setInviteDismissed] = useState(
    () => sessionStorage.getItem(INVITE_DISMISSED_KEY) === "true"
  );

  const audience: Audience = user?.role === "skater" ? "skater" : "club";
  const chapters = useMemo(() => chaptersFor(audience), [audience]);
  const tourSeen = user?.tutorial_seen === true;

  const openDoc = useCallback(
    (chapterId?: string) => setDocChapterId(chapterId ?? chapters[0]?.id ?? null),
    [chapters]
  );
  const closeDoc = useCallback(() => setDocChapterId(null), []);

  const markScreenSeen = useCallback((pattern: string) => {
    const seen = readSeenScreens();
    if (!seen.includes(pattern)) writeSeenScreens([...seen, pattern]);
  }, []);

  /** Persiste « vu » et rafraîchit l'utilisateur en mémoire, pour que le bouton
   *  de démarrage disparaisse sans rechargement. L'échec réseau est silencieux :
   *  le tutoriel a bien été suivi, seul l'état distant manque. */
  const markSeen = useCallback(async () => {
    if (!user || user.tutorial_seen) return;
    updateUser({ ...user, tutorial_seen: true });
    try {
      await api.me.updatePreferences({ tutorial_seen: true });
    } catch {
      // Sans effet visible : l'invite reviendra à la prochaine session.
    }
  }, [user, updateUser]);

  const startTour = useCallback(() => {
    // Remise à zéro au DÉMARRAGE, pas à la fin : un tutoriel relancé des mois
    // plus tard doit être complet, pas muet.
    writeSeenScreens([]);
    sessionStorage.setItem(TOUR_MODE_KEY, "true");
    setTourMode(true);
    setDocChapterId(null);
    setSteps([]);
    setStepIndex(0);
  }, []);

  const endTour = useCallback(() => {
    sessionStorage.removeItem(TOUR_MODE_KEY);
    setTourMode(false);
    setSteps([]);
    setStepIndex(0);
    void markSeen();
  }, [markSeen]);

  const closeOverlay = useCallback(() => {
    const pattern = screenPatternFor(pathname);
    if (pattern) markScreenSeen(pattern);
    setSteps([]);
    setStepIndex(0);
  }, [pathname, markScreenSeen]);

  const replayScreen = useCallback(() => {
    const screen = screenTourFor(pathname, audience);
    if (!screen) return;
    setSteps(screen.steps);
    setStepIndex(0);
  }, [pathname, audience]);

  const nextStep = useCallback(
    () => setStepIndex((i) => (i + 1 < steps.length ? i + 1 : i)),
    [steps.length]
  );
  const prevStep = useCallback(
    () => setStepIndex((i) => (i > 0 ? i - 1 : i)),
    []
  );

  const dismissInvite = useCallback(() => {
    sessionStorage.setItem(INVITE_DISMISSED_KEY, "true");
    setInviteDismissed(true);
  }, []);

  // Déclenchement à l'arrivée sur un écran. Le délai laisse la page monter et
  // ses requêtes se résoudre : sans lui, les ancres d'un écran qui charge ses
  // données seraient absentes du DOM et toutes les étapes seraient filtrées.
  const lastHandled = useRef<string | null>(null);

  useEffect(() => {
    if (!tourMode) {
      lastHandled.current = null;
      return;
    }
    const pattern = screenPatternFor(pathname);
    if (!pattern || lastHandled.current === pattern) return;
    if (readSeenScreens().includes(pattern)) {
      lastHandled.current = pattern;
      return;
    }

    const timer = setTimeout(() => {
      const screen = screenTourFor(pathname, audience);
      lastHandled.current = pattern;
      if (!screen) {
        // Aucune étape affichable ici (données absentes, mauvais parcours) :
        // marquer vu plutôt que d'encadrer le vide.
        markScreenSeen(pattern);
        return;
      }
      setSteps(screen.steps);
      setStepIndex(0);
    }, 400);

    return () => clearTimeout(timer);
  }, [tourMode, pathname, audience, markScreenSeen]);

  const overlayVisible = tourMode && steps.length > 0;
  const currentScreen = useMemo(
    () => (tourMode ? screenPatternFor(pathname) : null),
    [tourMode, pathname]
  );
  const currentScreenLabel = useMemo(() => {
    if (!currentScreen) return null;
    return screenTourFor(pathname, audience)?.label ?? null;
  }, [currentScreen, pathname, audience]);

  const inviteOpen =
    !passwordModalOpen && !tourSeen && !inviteDismissed && !tourMode;

  const value: HelpState = {
    audience,
    chapters,
    docChapterId,
    openDoc,
    closeDoc,
    tourMode,
    startTour,
    endTour,
    steps,
    stepIndex,
    overlayVisible,
    nextStep,
    prevStep,
    closeOverlay,
    replayScreen,
    currentScreenLabel,
    hasStepsHere: currentScreenLabel !== null,
    tourSeen,
    inviteOpen,
    dismissInvite,
  };

  return <HelpContext.Provider value={value}>{children}</HelpContext.Provider>;
}

export function useHelp(): HelpState {
  const ctx = useContext(HelpContext);
  if (!ctx) throw new Error("useHelp must be used within HelpProvider");
  return ctx;
}
