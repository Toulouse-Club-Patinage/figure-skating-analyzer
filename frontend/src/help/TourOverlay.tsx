import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useHelp } from "./HelpContext";

type Rect = { top: number; left: number; width: number; height: number };

const PAD = 6;       // marge du surlignage autour de la cible
const BUBBLE_W = 320;
const GAP = 12;      // écart entre la cible et la bulle
const BUBBLE_H_ESTIMATE = 191; // hauteur de repli avant la première mesure réelle

export default function TourOverlay() {
  const {
    overlayVisible,
    steps,
    stepIndex,
    nextStep,
    prevStep,
    closeOverlay,
    openDoc,
    chapters,
  } = useHelp();
  const [rect, setRect] = useState<Rect | null>(null);
  const [bubbleHeight, setBubbleHeight] = useState<number>(BUBBLE_H_ESTIMATE);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const step = overlayVisible ? steps[stepIndex] : null;

  const measure = useCallback(() => {
    if (!step) return;
    const el = document.querySelector(`[data-tour="${step.target}"]`);
    if (!el) {
      setRect(null);
    } else {
      const r = el.getBoundingClientRect();
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    }
    if (bubbleRef.current) {
      setBubbleHeight(bubbleRef.current.getBoundingClientRect().height);
    }
  }, [step]);

  // Mesure avant peinture pour éviter un cadre au mauvais endroit sur une
  // frame, après avoir amené la cible dans la vue.
  useLayoutEffect(() => {
    if (!step) return;
    const el = document.querySelector(`[data-tour="${step.target}"]`);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
    measure();
  }, [step, measure]);

  useEffect(() => {
    if (!overlayVisible) return;
    window.addEventListener("resize", measure, { passive: true });
    window.addEventListener("scroll", measure, { passive: true });
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure);
    };
  }, [overlayVisible, measure]);

  // Le focus part sur la bulle à chaque étape : le lecteur d'écran annonce le
  // nouveau contenu, et Tab reste dans la bulle.
  useEffect(() => {
    if (overlayVisible) bubbleRef.current?.focus();
  }, [overlayVisible, stepIndex]);

  // Échap ferme l'explication de cet écran — sans quitter le mode tutoriel.
  useEffect(() => {
    if (!overlayVisible) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeOverlay();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [overlayVisible, closeOverlay]);

  if (!overlayVisible || !step) return null;

  const isLast = stepIndex === steps.length - 1;
  const hasChapter =
    step.chapterId !== undefined &&
    chapters.some((c) => c.id === step.chapterId);

  // Cible introuvable au moment du rendu : bulle centrée, sans surlignage.
  const box = rect ?? {
    top: window.innerHeight / 2,
    left: window.innerWidth / 2,
    width: 0,
    height: 0,
  };

  // Préférence : sous la cible, sinon au-dessus, sinon là où ça tient — mais
  // toujours entièrement dans le viewport verticalement (jamais rogné en
  // haut ni en bas).
  const below = window.innerHeight - (box.top + box.height) > bubbleHeight + GAP;
  const above = box.top > bubbleHeight + GAP;
  const rawTop = below
    ? box.top + box.height + GAP
    : above
      ? box.top - bubbleHeight - GAP
      : box.top; // la cible ne laisse de place ni dessus ni dessous : on
                 // recadre simplement dans le viewport ci-dessous, un
                 // recouvrement de la cible est acceptable dans ce cas.
  const maxTop = window.innerHeight - bubbleHeight - GAP;
  const bubbleTop = Math.min(Math.max(GAP, rawTop), Math.max(GAP, maxTop));
  const bubbleLeft = Math.min(
    Math.max(GAP, box.left + box.width / 2 - BUBBLE_W / 2),
    window.innerWidth - BUBBLE_W - GAP
  );

  return (
    <div className="fixed inset-0 z-[60]">
      {/* Masque en quatre rectangles autour de la cible. */}
      <div aria-hidden="true" onClick={closeOverlay}>
        <div
          className="absolute bg-on-surface/60 left-0 right-0 top-0"
          style={{ height: Math.max(0, box.top - PAD) }}
        />
        <div
          className="absolute bg-on-surface/60 left-0 right-0 bottom-0"
          style={{ top: box.top + box.height + PAD }}
        />
        <div
          className="absolute bg-on-surface/60 left-0"
          style={{
            top: box.top - PAD,
            height: box.height + PAD * 2,
            width: Math.max(0, box.left - PAD),
          }}
        />
        <div
          className="absolute bg-on-surface/60 right-0"
          style={{
            top: box.top - PAD,
            height: box.height + PAD * 2,
            left: box.left + box.width + PAD,
          }}
        />
      </div>

      {rect && (
        <div
          aria-hidden="true"
          className="absolute rounded-xl ring-2 ring-primary pointer-events-none"
          style={{
            top: box.top - PAD,
            left: box.left - PAD,
            width: box.width + PAD * 2,
            height: box.height + PAD * 2,
          }}
        />
      )}

      <div
        ref={bubbleRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Explication de l'écran"
        className="absolute bg-surface rounded-2xl shadow-2xl p-4 focus:outline-none"
        style={{
          width: BUBBLE_W,
          top: bubbleTop,
          left: bubbleLeft,
        }}
      >
        <div aria-live="polite">
          <h2 className="font-headline font-bold text-on-surface text-sm mb-1">
            {step.title}
          </h2>
          <p className="text-sm text-on-surface-variant mb-3">{step.body}</p>
        </div>

        {hasChapter && (
          <button
            onClick={() => {
              closeOverlay();
              openDoc(step.chapterId);
            }}
            className="text-xs text-primary hover:underline mb-3 inline-flex items-center gap-1"
          >
            En savoir plus
            <span className="material-symbols-outlined text-sm">
              arrow_forward
            </span>
          </button>
        )}

        <div className="flex items-center gap-2">
          <span className="text-xs text-on-surface-variant font-mono">
            {stepIndex + 1} / {steps.length}
          </span>
          <div className="flex-1" />
          {stepIndex > 0 && (
            <button
              onClick={prevStep}
              className="px-3 py-1.5 rounded-xl text-xs font-bold text-on-surface-variant hover:bg-surface-container transition-colors"
            >
              Précédent
            </button>
          )}
          <button
            onClick={isLast ? closeOverlay : nextStep}
            className="px-3 py-1.5 bg-primary text-on-primary rounded-xl text-xs font-bold"
          >
            {isLast ? "Terminer cet écran" : "Suivant"}
          </button>
        </div>
      </div>
    </div>
  );
}
