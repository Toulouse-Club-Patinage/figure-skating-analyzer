import React, { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { api, downloadPdf, Element, Score, CategoryResult, WeeklyReview, TrainingIncident, TrainingChallenge, SelfEvaluation, componentScore } from "../api/client";
import ElementGOEChart from "../components/ElementGOEChart";
import PCSRadarChart from "../components/PCSRadarChart";
import ElementDifficultyChart from "../components/ElementDifficultyChart";
import JudgePanel from "../components/JudgePanel";
import ScoreCardModal from "../components/ScoreCardModal";
import TrainingEvolutionChart from "../components/TrainingEvolutionChart";
import MoodInput from "../components/MoodInput";
import SelfEvalModal from "../components/SelfEvalModal";
import ProgramEditor from "../components/ProgramEditor";
import TrainingJournal from "../components/TrainingJournal";
import { countryFlag } from "../utils/countryFlags";
import {
  isJumpElement,
  isSpinElement,
  isStepElement,
  elementLevel,
  jumpRotations,
} from "../utils/elementClassifier";
import { useAuth } from "../auth/AuthContext";
import { seasonDateRange } from "../utils/season";

// ─── Helpers ──────────────────────────────────────────────────────────────────
function avg(arr: number[]) {
  if (!arr.length) return null;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function formatGoe(goe: number | null) {
  if (goe == null) return "—";
  return `${goe >= 0 ? "+" : ""}${goe.toFixed(2)}`;
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────
function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-pulse bg-surface-container-low rounded-xl ${className}`}
    />
  );
}

// ─── Element family card (precision + level + GOE) ───────────────────────────
function ElementFamilyCard({
  label,
  percent,
  leftLabel,
  leftValue,
  rightLabel,
  rightValue,
  info,
}: {
  label: string;
  percent: number;
  leftLabel: string;
  leftValue: string;
  rightLabel: string;
  rightValue: string;
  info?: string;
}) {
  return (
    <div className="bg-surface-container-lowest rounded-xl shadow-sm p-5">
      <div className="flex items-center gap-1.5 mb-2">
        <p className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant">
          {label}
        </p>
        {info && (
          <span className="group relative cursor-help">
            <span className="material-symbols-outlined text-on-surface-variant text-[14px]">info</span>
            <span className="invisible group-hover:visible absolute left-1/2 -translate-x-1/2 bottom-full mb-1.5 w-56 bg-on-surface text-surface text-[11px] font-body font-normal normal-case tracking-normal rounded-lg px-3 py-2 shadow-lg z-50 leading-relaxed">
              {info}
            </span>
          </span>
        )}
      </div>
      <p className="text-2xl font-extrabold font-headline text-on-surface font-mono">
        {percent.toFixed(1)}
        <span className="text-sm font-body font-normal text-on-surface-variant ml-1">
          % de précision
        </span>
      </p>
      <div className="mt-3 h-1.5 rounded-full bg-primary-container overflow-hidden">
        <div
          className="h-full rounded-full bg-primary transition-all duration-500"
          style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
        />
      </div>
      <div className="grid grid-cols-2 gap-4 mt-4">
        <div>
          <p className="text-[9px] font-bold uppercase tracking-widest text-on-surface-variant mb-0.5">
            {leftLabel}
          </p>
          <p className="text-xl font-extrabold font-headline text-on-surface font-mono">
            {leftValue}
          </p>
        </div>
        <div>
          <p className="text-[9px] font-bold uppercase tracking-widest text-on-surface-variant mb-0.5">
            {rightLabel}
          </p>
          <p className="text-xl font-extrabold font-headline text-on-surface font-mono">
            {rightValue}
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Stats box in hero ────────────────────────────────────────────────────────
function HeroStatBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white/15 backdrop-blur-sm rounded-xl px-5 py-3 text-center">
      <p className="text-2xl font-extrabold font-headline text-white font-mono">{value}</p>
      <p className="text-[10px] uppercase tracking-widest text-white/70 mt-0.5">{label}</p>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function SkaterAnalyticsPage() {
  const { id } = useParams<{ id: string }>();
  const skaterId = Number(id);
  const { user } = useAuth();
  const qc = useQueryClient();
  const [selectedSeason, setSelectedSeason] = useState<string | null>(null);
  const [analyticsTab, setAnalyticsTab] = useState<"competitions" | "training" | "journal">(
    user?.role === "skater" ? "journal" : "competitions"
  );
  const [editingSkater, setEditingSkater] = useState(false);
  const [editForm, setEditForm] = useState({ first_name: "", last_name: "", nationality: "", club: "" });
  const [trainingSubTab, setTrainingSubTab] = useState<"reviews" | "challenges" | "incidents" | "evolution" | "journal">(
    user?.role === "skater" ? "journal" : "reviews"
  );
  const [viewingReview, setViewingReview] = useState<WeeklyReview | undefined>();
  const [viewingChallenge, setViewingChallenge] = useState<TrainingChallenge | undefined>();
  const [viewingIncident, setViewingIncident] = useState<TrainingIncident | undefined>();
  const [showEvalModal, setShowEvalModal] = useState(false);
  const [editingEval, setEditingEval] = useState<SelfEvaluation | undefined>();
  const selfEvalToday = new Date().toISOString().slice(0, 10);

  // Week bounds for journal
  const _now = new Date();
  const _monday = new Date(_now);
  _monday.setDate(_now.getDate() - ((_now.getDay() + 6) % 7));
  const _sunday = new Date(_monday);
  _sunday.setDate(_monday.getDate() + 6);
  const weekStart = _monday.toISOString().slice(0, 10);
  const weekEnd = _sunday.toISOString().slice(0, 10);

  const { data: config } = useQuery({
    queryKey: ["config"],
    queryFn: api.config.get,
    staleTime: Infinity,
  });

  const { data: skater, isLoading: loadingSkater } = useQuery({
    queryKey: ["skater", skaterId],
    queryFn: () => api.skaters.get(skaterId),
  });

  // Full training tab (with coach sub-tabs) visible for tracked skaters or coaches/admins
  const showTrainingTab = config?.training_enabled && (
    (user?.role === "skater" && skater?.training_tracked) || (
      (user?.role === "admin" || user?.role === "coach") && skater?.training_tracked
    )
  );
  // Journal-only tab for skater role even if not tracked
  const showJournalTab = config?.training_enabled && user?.role === "skater";

  const toggleTrainingTracked = useMutation({
    mutationFn: () => api.skaters.update(skaterId, { training_tracked: !skater?.training_tracked }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["skater", skaterId] });
      qc.invalidateQueries({ queryKey: ["skaters"] });
    },
  });

  const updateSkaterMutation = useMutation({
    mutationFn: (data: { first_name: string; last_name: string; nationality: string; club: string }) =>
      api.skaters.update(skaterId, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["skater", skaterId] });
      qc.invalidateQueries({ queryKey: ["skaters"] });
      setEditingSkater(false);
    },
  });

  const { data: seasons } = useQuery({
    queryKey: ["skater-seasons", skaterId],
    queryFn: () => api.skaters.seasons(skaterId),
  });

  const { data: scores, isLoading: loadingScores } = useQuery({
    queryKey: ["skater-scores", skaterId, selectedSeason],
    queryFn: () => api.skaters.scores(skaterId, selectedSeason ?? undefined),
    placeholderData: keepPreviousData,
  });

  const { data: elements, isLoading: loadingElements } = useQuery({
    queryKey: ["skater-elements", skaterId, selectedSeason],
    queryFn: () => api.skaters.elements(skaterId, { season: selectedSeason ?? undefined }),
    placeholderData: keepPreviousData,
  });

  const { data: categoryResults, isLoading: loadingCatResults } = useQuery({
    queryKey: ["skater-category-results", skaterId, selectedSeason],
    queryFn: () => api.skaters.categoryResults(skaterId, selectedSeason ?? undefined),
    placeholderData: keepPreviousData,
  });

  const trainingSeasonRange = selectedSeason ? seasonDateRange(selectedSeason) : undefined;

  const { data: trainingReviews } = useQuery({
    queryKey: ["training", "reviews", skaterId, selectedSeason],
    queryFn: () => api.training.reviews.list({
      skater_id: skaterId,
      ...(trainingSeasonRange ? { from: trainingSeasonRange.from, to: trainingSeasonRange.to } : {}),
    }),
    enabled: showTrainingTab,
  });

  const { data: trainingIncidents } = useQuery({
    queryKey: ["training", "incidents", skaterId, selectedSeason],
    queryFn: () => api.training.incidents.list({
      skater_id: skaterId,
      ...(trainingSeasonRange ? { from: trainingSeasonRange.from, to: trainingSeasonRange.to } : {}),
    }),
    enabled: showTrainingTab,
  });

  const { data: trainingChallenges } = useQuery({
    queryKey: ["training", "challenges", skaterId, selectedSeason],
    queryFn: () => api.training.challenges.list({
      skater_id: skaterId,
      ...(trainingSeasonRange ? { from: trainingSeasonRange.from, to: trainingSeasonRange.to } : {}),
    }),
    enabled: showTrainingTab,
  });

  // Today's self-evaluations (for the eval panel)
  const { data: selfEvalsToday } = useQuery({
    queryKey: ["selfEvaluations", skaterId, selfEvalToday, selfEvalToday],
    queryFn: () => api.training.selfEvaluations.list({
      skater_id: skaterId,
      from: selfEvalToday,
      to: selfEvalToday,
    }),
    enabled: user?.role === "skater" && !!config?.training_enabled,
  });

  const isLoading = loadingSkater || loadingScores || loadingElements || loadingCatResults;

  // ── Progression chart mode ─────────────────────────────────────────────────
  const [progressionMode, setProgressionMode] = useState<"result" | "segments" | "tes" | "pcs">("result");
  const [pcsSegmentFilter, setPcsSegmentFilter] = useState<"sp" | "fs">("sp");

  // ── Derived: score progression (competition results) ───────────────────────
  // Use categoryResults as primary source; fall back to scores for competitions
  // where no category_result row exists (e.g. single-segment with missing row).
  const progressionDataResult = (() => {
    const map = new Map<string, { date: string; label: string; total: number | null }>();

    // Seed from categoryResults first
    for (const r of categoryResults ?? []) {
      if (r.combined_total == null) continue;
      const key = `${r.competition_id}__${r.category ?? ""}`;
      map.set(key, {
        date: r.competition_date ? r.competition_date.slice(0, 10) : (r.competition_name ?? "?"),
        label: `${r.competition_name ?? ""} · ${r.category ?? ""}`,
        total: r.combined_total,
      });
    }

    // Fill gaps from scores (single-segment competitions missing a category result)
    for (const s of scores ?? []) {
      if (s.total_score == null) continue;
      const key = `${s.competition_id}__${s.category ?? ""}`;
      if (!map.has(key)) {
        map.set(key, {
          date: s.competition_date ? s.competition_date.slice(0, 10) : (s.competition_name ?? "?"),
          label: `${s.competition_name ?? ""} · ${s.category ?? ""}`,
          total: s.total_score,
        });
      }
    }

    return [...map.values()].sort((a, b) => (a.date > b.date ? 1 : -1));
  })();

  // ── Derived: score progression (segments: SP and FS on separate series) ────
  const progressionDataSegments = (() => {
    // Group scores by competition+category, keyed by date label
    const map = new Map<string, { date: string; label: string; sp?: number; fs?: number }>();
    for (const s of (scores ?? []).filter((s) => s.total_score != null)) {
      const key = `${s.competition_id}__${s.category ?? ""}`;
      if (!map.has(key)) {
        map.set(key, {
          date: s.competition_date ? s.competition_date.slice(0, 10) : (s.competition_name ?? "?"),
          label: `${s.competition_name ?? ""} · ${s.category ?? ""}`,
        });
      }
      const entry = map.get(key)!;
      const seg = s.segment?.toUpperCase();
      if (seg === "SP" || seg === "PH") entry.sp = s.total_score ?? undefined;
      else if (seg === "FS" || seg === "FP" || seg === "LD") entry.fs = s.total_score ?? undefined;
    }
    return [...map.values()].sort((a, b) => (a.date > b.date ? 1 : -1));
  })();

  // ── Derived: TES progression (SP and FS technical_score) ──────────────────
  const progressionDataTes = (() => {
    const map = new Map<string, { date: string; label: string; sp?: number; fs?: number }>();
    for (const s of (scores ?? []).filter((s) => s.technical_score != null)) {
      const key = `${s.competition_id}__${s.category ?? ""}`;
      if (!map.has(key)) {
        map.set(key, {
          date: s.competition_date ? s.competition_date.slice(0, 10) : (s.competition_name ?? "?"),
          label: `${s.competition_name ?? ""} · ${s.category ?? ""}`,
        });
      }
      const entry = map.get(key)!;
      const seg = s.segment?.toUpperCase();
      if (seg === "SP" || seg === "PH") entry.sp = s.technical_score ?? undefined;
      else if (seg === "FS" || seg === "FP" || seg === "LD") entry.fs = s.technical_score ?? undefined;
    }
    return [...map.values()].sort((a, b) => (a.date > b.date ? 1 : -1));
  })();

  // ── Derived: PCS progression (per-component, filtered by segment) ───────
  const PCS_COLORS = ["#2e6385", "#7cb9e8", "#e57373", "#81c784", "#ffb74d", "#ba68c8", "#4dd0e1", "#f06292"];

  const pcsComponentNames = (() => {
    const nameSet = new Set<string>();
    for (const s of scores ?? []) {
      if (!s.components) continue;
      const seg = s.segment?.toUpperCase();
      const matchesSp = seg === "SP" || seg === "PH";
      const matchesFs = seg === "FS" || seg === "FP" || seg === "LD";
      if ((pcsSegmentFilter === "sp" && matchesSp) || (pcsSegmentFilter === "fs" && matchesFs)) {
        for (const name of Object.keys(s.components)) nameSet.add(name);
      }
    }
    return [...nameSet].sort();
  })();

  const progressionDataPcs = (() => {
    const map = new Map<string, { date: string; label: string; [comp: string]: string | number | undefined }>();
    for (const s of scores ?? []) {
      if (!s.components) continue;
      const seg = s.segment?.toUpperCase();
      const matchesSp = seg === "SP" || seg === "PH";
      const matchesFs = seg === "FS" || seg === "FP" || seg === "LD";
      if ((pcsSegmentFilter === "sp" && !matchesSp) || (pcsSegmentFilter === "fs" && !matchesFs)) continue;

      const key = `${s.competition_id}__${s.category ?? ""}`;
      if (!map.has(key)) {
        map.set(key, {
          date: s.competition_date ? s.competition_date.slice(0, 10) : (s.competition_name ?? "?"),
          label: `${s.competition_name ?? ""} · ${s.category ?? ""}`,
        });
      }
      const entry = map.get(key)!;
      for (const [name, value] of Object.entries(s.components)) {
        entry[name] = componentScore(value);
      }
    }
    return [...map.values()].sort((a, b) => (String(a.date) > String(b.date) ? 1 : -1));
  })();

  // ── Derived: sorted competition history ────────────────────────────────────
  const sortedScores: Score[] = [...(scores ?? [])].sort((a, b) => {
    if (a.competition_date && b.competition_date)
      return a.competition_date > b.competition_date ? -1 : 1;
    return 0;
  });

  // ── Derived: competition history rows (group by competition+category) ────
  interface HistoryRow {
    key: string;
    competitionId: number;
    competitionName: string | null;
    competitionDate: string | null;
    category: string | null;
    club: string | null;
    catResult: CategoryResult | null;
    segmentScores: Score[];
  }

  const historyRows: HistoryRow[] = (() => {
    const map = new Map<string, HistoryRow>();
    for (const s of sortedScores) {
      const key = `${s.competition_id}__${s.category ?? ""}`;
      if (!map.has(key)) {
        const cr = (categoryResults ?? []).find(
          (r) => r.competition_id === s.competition_id && r.category === s.category
        ) ?? null;
        map.set(key, {
          key,
          competitionId: s.competition_id,
          competitionName: s.competition_name,
          competitionDate: s.competition_date,
          category: s.category,
          club: s.skater_club,
          catResult: cr,
          segmentScores: [],
        });
      }
      map.get(key)!.segmentScores.push(s);
    }
    return [...map.values()].sort((a, b) => {
      if (a.competitionDate && b.competitionDate)
        return a.competitionDate > b.competitionDate ? -1 : 1;
      return 0;
    });
  })();

  // ── Derived: best TSS (max across category results + scores without a result) ──
  const bestTss = (() => {
    const catKeys = new Set<string>();
    let best: number | null = null;

    for (const r of categoryResults ?? []) {
      if (r.combined_total == null) continue;
      catKeys.add(`${r.competition_id}__${r.category ?? ""}`);
      if (best == null || r.combined_total > best) best = r.combined_total;
    }

    // Also consider scores from competitions missing a category result
    for (const s of scores ?? []) {
      if (s.total_score == null) continue;
      const key = `${s.competition_id}__${s.category ?? ""}`;
      if (!catKeys.has(key)) {
        if (best == null || s.total_score > best) best = s.total_score;
      }
    }

    return best;
  })();

  // ── Derived: element KPIs ──────────────────────────────────────────────────
  const hasElements = elements && elements.length > 0;

  const familyStats = (
    predicate: (name: string) => boolean,
    levelOf: (name: string) => number[]
  ) => {
    if (!elements?.length) return null;
    const family = elements.filter((el) => predicate(el.element_name));
    if (!family.length) return null;
    const positive = family.filter((el) => (el.goe ?? 0) > 0).length;
    const levels = family.flatMap((el) => levelOf(el.element_name));
    const goeVals = family.map((el) => el.goe).filter((g): g is number => g != null);
    return {
      precision: (positive / family.length) * 100,
      avgLevel: avg(levels),
      avgGoe: avg(goeVals),
    };
  };

  const jumpStats = familyStats(isJumpElement, jumpRotations);
  const spinStats = familyStats(isSpinElement, (name) => [elementLevel(name)]);
  const stepStats = familyStats(isStepElement, (name) => [elementLevel(name)]);

  // ── Selected score for element detail panel ────────────────────────────────
  const [selectedScoreId, setSelectedScoreId] = useState<number | null>(null);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  // ── Score card modal ───────────────────────────────────────────────────────
  const [modalScore, setModalScore] = useState<Score | null>(null);

  function toggleCollapsed(key: string) {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  const activeScoreId = selectedScoreId ?? sortedScores[0]?.id ?? null;
  const activeScore = sortedScores.find((s) => s.id === activeScoreId) ?? null;
  const activeScoreElements = (elements ?? []).filter(
    (el) => activeScore && el.score_id === activeScore.id
  );

  // ─────────────────────────────────────────────────────────────────────────────
  if (!isLoading && !skater) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] text-on-surface-variant font-body">
        Patineur introuvable.
      </div>
    );
  }

  return (
    // `data-tour-tab` annonce l'onglet actif au tutoriel : cet écran change de
    // contenu sans changer d'URL, et sans cet indice seul l'onglet ouvert à
    // l'arrivée serait expliqué.
    <div className="min-h-screen bg-surface font-body" data-tour-tab={analyticsTab}>
      {/* Score card modal */}
      {modalScore && (
        <ScoreCardModal
          score={modalScore}
          skaterName={skater ? `${skater.first_name} ${skater.last_name}` : ""}
          onClose={() => setModalScore(null)}
        />
      )}

      {/* Back link */}
      <div className="px-6 pt-5 pb-2">
        <Link
          to="/patineurs"
          className="text-primary text-xs font-bold uppercase tracking-wider hover:underline flex items-center gap-1"
        >
          <span className="material-symbols-outlined text-base">arrow_back</span>
          Retour
        </Link>
      </div>

      {/* ── Hero ── */}
      {isLoading ? (
        <Skeleton className="mx-6 h-36 rounded-2xl" />
      ) : (
        <div data-tour="analyse-entete" className="bg-gradient-to-r from-primary to-on-primary-fixed-variant py-6 px-4 sm:py-8 sm:px-8 flex flex-col sm:flex-row items-start sm:items-center gap-4 sm:gap-6">
          <div className="flex items-center gap-4 w-full min-w-0 sm:flex-1">
            <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center text-2xl font-extrabold font-headline text-white ring-2 ring-white/30 shrink-0">
              {skater?.last_name?.[0]?.toUpperCase() ?? "?"}
            </div>
            <div className="min-w-0 overflow-hidden">
              <div className="flex items-center gap-2">
                <h1 className="text-2xl sm:text-3xl font-extrabold font-headline text-white leading-tight truncate">
                  {skater ? `${skater.first_name} ${skater.last_name}` : "—"}
                </h1>
                {user?.role === "admin" && config?.training_enabled && (
                  <button
                    onClick={() => toggleTrainingTracked.mutate()}
                    disabled={toggleTrainingTracked.isPending}
                    className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center transition-colors disabled:opacity-50 ${
                      skater?.training_tracked
                        ? "bg-white/25 text-white hover:bg-white/35"
                        : "bg-white/10 text-white/50 hover:bg-white/20"
                    }`}
                    title={skater?.training_tracked ? "Retirer du suivi entraînement" : "Ajouter au suivi entraînement"}
                  >
                    <span className="material-symbols-outlined text-[16px] leading-none">
                      {skater?.training_tracked ? "fitness_center" : "add"}
                    </span>
                  </button>
                )}
              </div>
              <p className="text-sm text-white/70 mt-1 truncate">
                {[
                  skater?.club,
                  skater?.nationality ? `${countryFlag(skater.nationality) ?? ""} ${skater.nationality}` : null,
                ].filter(Boolean).join(" · ")}
                {skater?.birth_year ? ` · ${skater.birth_year}` : ""}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-3 shrink-0 items-center">
            {seasons && seasons.length > 0 && (
              <select
                value={selectedSeason ?? ""}
                onChange={(e) => setSelectedSeason(e.target.value || null)}
                className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-2.5 text-sm text-white font-bold font-headline appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-white/30"
              >
                <option value="" className="text-on-surface bg-surface">Toutes les saisons</option>
                {seasons.map((s) => (
                  <option key={s} value={s} className="text-on-surface bg-surface">{s}</option>
                ))}
              </select>
            )}
            {selectedSeason && (
              <button
                onClick={() => downloadPdf(`/reports/skater/${skaterId}/pdf?season=${selectedSeason}`).catch((e) => alert(`Erreur : ${e.message}`))}
                className="flex items-center gap-1.5 bg-white/15 backdrop-blur-sm rounded-xl px-4 py-2.5 text-sm text-white font-bold font-headline hover:bg-white/25 transition-colors cursor-pointer"
              >
                <span className="material-symbols-outlined text-sm">picture_as_pdf</span>
                Exporter le bilan
              </button>
            )}
            <HeroStatBox
              label="Meilleur score"
              value={bestTss != null ? bestTss.toFixed(2) : "—"}
            />
            <HeroStatBox
              label="Compétitions"
              value={String(historyRows.length)}
            />
            {user?.role === "admin" && skater?.manual_create && (
              <button
                onClick={() => {
                  setEditForm({
                    first_name: skater.first_name,
                    last_name: skater.last_name,
                    nationality: skater.nationality ?? "",
                    club: skater.club ?? "",
                  });
                  setEditingSkater(true);
                }}
                className="flex items-center gap-1.5 bg-white/15 backdrop-blur-sm rounded-xl px-4 py-2.5 text-sm text-white font-bold font-headline hover:bg-white/25 transition-colors cursor-pointer"
                title="Modifier les informations"
              >
                <span className="material-symbols-outlined text-sm">edit</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Edit panel for manually created skaters */}
      {editingSkater && skater?.manual_create && user?.role === "admin" && (
        <div className="mx-6 mt-4 p-4 bg-surface-container-lowest rounded-xl shadow-arctic space-y-3">
          <h3 className="text-xs font-bold text-on-surface-variant uppercase tracking-wider">
            Modifier le patineur
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-lg">
            <div>
              <label className="block text-xs font-medium text-on-surface-variant mb-1">Prénom</label>
              <input
                value={editForm.first_name}
                onChange={(e) => setEditForm((f) => ({ ...f, first_name: e.target.value }))}
                className="w-full px-3 py-2 bg-surface-container-low rounded-xl text-on-surface text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-on-surface-variant mb-1">Nom</label>
              <input
                value={editForm.last_name}
                onChange={(e) => setEditForm((f) => ({ ...f, last_name: e.target.value }))}
                className="w-full px-3 py-2 bg-surface-container-low rounded-xl text-on-surface text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-on-surface-variant mb-1">Nation</label>
              <input
                value={editForm.nationality}
                onChange={(e) => setEditForm((f) => ({ ...f, nationality: e.target.value }))}
                className="w-full px-3 py-2 bg-surface-container-low rounded-xl text-on-surface text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                maxLength={3}
                placeholder="FRA"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-on-surface-variant mb-1">Club</label>
              <input
                value={editForm.club}
                onChange={(e) => setEditForm((f) => ({ ...f, club: e.target.value }))}
                className="w-full px-3 py-2 bg-surface-container-low rounded-xl text-on-surface text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => updateSkaterMutation.mutate(editForm)}
              disabled={updateSkaterMutation.isPending || !editForm.last_name.trim()}
              className="px-4 py-2 bg-primary text-on-primary rounded-xl text-sm font-bold hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {updateSkaterMutation.isPending ? "Enregistrement..." : "Enregistrer"}
            </button>
            <button
              onClick={() => setEditingSkater(false)}
              className="px-4 py-2 text-on-surface-variant text-sm"
            >
              Annuler
            </button>
          </div>
        </div>
      )}

      {/* Tab bar */}
      {(showTrainingTab || showJournalTab) && (
        <div className="px-6 pt-4">
          <div className="flex gap-0">
            {showJournalTab && !showTrainingTab && (
              <button
                onClick={() => setAnalyticsTab("journal")}
                className={`px-5 py-2 text-sm font-semibold transition-colors border-b-2 ${
                  analyticsTab === "journal"
                    ? "text-primary border-primary"
                    : "text-on-surface-variant border-transparent hover:text-on-surface"
                }`}
              >
                Journal
              </button>
            )}
            {showTrainingTab && (
              <button
                onClick={() => setAnalyticsTab("training")}
                className={`px-5 py-2 text-sm font-semibold transition-colors border-b-2 ${
                  analyticsTab === "training" || analyticsTab === "journal"
                    ? "text-primary border-primary"
                    : "text-on-surface-variant border-transparent hover:text-on-surface"
                }`}
              >
                Entraînement
              </button>
            )}
            <button
              onClick={() => setAnalyticsTab("competitions")}
              className={`px-5 py-2 text-sm font-semibold transition-colors border-b-2 ${
                analyticsTab === "competitions"
                  ? "text-primary border-primary"
                  : "text-on-surface-variant border-transparent hover:text-on-surface"
              }`}
            >
              Compétitions
            </button>
          </div>
        </div>
      )}

      {/* ── Journal tab (top-level, non-tracked skaters) ── */}
      {analyticsTab === "journal" && !showTrainingTab && showJournalTab && (() => {
        const todayEvals = (selfEvalsToday ?? []);
        return (
          <div className="p-6 space-y-4" data-tour="analyse-journal">
            <MoodInput skaterId={skaterId} today={selfEvalToday} />

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-surface-container-lowest rounded-xl shadow-sm p-5" data-tour="analyse-autoeval">
                <p className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant mb-3">
                  Auto-evaluations du jour
                </p>
                {todayEvals.length > 0 && (
                  <div className="space-y-2 mb-3">
                    {todayEvals.map((ev) => (
                      <button
                        key={ev.id}
                        onClick={() => { setEditingEval(ev); setShowEvalModal(true); }}
                        className="w-full flex items-center gap-2 text-left bg-surface-container-low rounded-lg px-3 py-2 hover:bg-surface-container transition-colors"
                      >
                        <span className="material-symbols-outlined text-primary text-sm">edit_note</span>
                        <span className="text-xs text-on-surface truncate flex-1">
                          {ev.notes || "Evaluation"}
                        </span>
                        <span className="material-symbols-outlined text-on-surface-variant text-sm">chevron_right</span>
                      </button>
                    ))}
                  </div>
                )}
                <button
                  onClick={() => { setEditingEval(undefined); setShowEvalModal(true); }}
                  className="bg-primary text-on-primary rounded-lg px-5 py-2.5 text-xs font-bold active:scale-95 transition-all w-full"
                >
                  Nouvelle evaluation
                </button>
              </div>
              <ProgramEditor skaterId={skaterId} />
            </div>

            <TrainingJournal
              skaterId={skaterId}
              weekStart={weekStart}
              weekEnd={weekEnd}
              onEditEval={(ev) => { setEditingEval(ev); setShowEvalModal(true); }}
            />

            {showEvalModal && (
              <SelfEvalModal
                skaterId={skaterId}
                today={selfEvalToday}
                existingEval={editingEval}
                onClose={() => { setShowEvalModal(false); setEditingEval(undefined); }}
              />
            )}
          </div>
        );
      })()}

      {/* ── Main content ── */}
      {(analyticsTab === "competitions" || (!showTrainingTab && !showJournalTab)) && (
        <>
          <div className="p-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ────────── LEFT PANEL ────────── */}
        <div className="lg:col-span-2 flex flex-col gap-6">
          {/* Score progression chart */}
          <div data-tour="analyse-evolution" className="bg-surface-container-lowest rounded-xl shadow-sm p-6">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
              <h2 className="text-base font-extrabold font-headline text-on-surface">
                Analyse longitudinale des scores
              </h2>
              <div className="flex items-center gap-2">
                {progressionMode === "pcs" && (
                  <div className="flex rounded-lg overflow-hidden border border-outline-variant text-xs font-bold">
                    <button
                      onClick={() => setPcsSegmentFilter("sp")}
                      className={`px-2.5 py-1 transition-colors ${
                        pcsSegmentFilter === "sp"
                          ? "bg-primary text-on-primary"
                          : "bg-surface text-on-surface-variant hover:bg-surface-container"
                      }`}
                    >
                      SP
                    </button>
                    <button
                      onClick={() => setPcsSegmentFilter("fs")}
                      className={`px-2.5 py-1 transition-colors ${
                        pcsSegmentFilter === "fs"
                          ? "bg-primary text-on-primary"
                          : "bg-surface text-on-surface-variant hover:bg-surface-container"
                      }`}
                    >
                      FS
                    </button>
                  </div>
                )}
                <select
                  value={progressionMode}
                  onChange={(e) => setProgressionMode(e.target.value as typeof progressionMode)}
                  className="bg-surface-container-high rounded-lg px-3 py-1.5 text-xs font-bold text-on-surface focus:outline-none focus:ring-2 focus:ring-primary cursor-pointer"
                >
                  <option value="result">Résultat</option>
                  <option value="segments">Segments</option>
                  <option value="tes">TES</option>
                  <option value="pcs">PCS</option>
                </select>
              </div>
            </div>
            {isLoading ? (
              <Skeleton className="h-[260px] w-full" />
            ) : progressionMode === "result" && progressionDataResult.length === 0 ? (
              <div className="flex items-center justify-center h-[260px] text-on-surface-variant text-sm">
                Aucune donnée de résultat disponible
              </div>
            ) : progressionMode === "segments" && progressionDataSegments.length === 0 ? (
              <div className="flex items-center justify-center h-[260px] text-on-surface-variant text-sm">
                Aucune donnée de segment disponible
              </div>
            ) : progressionMode === "tes" && progressionDataTes.length === 0 ? (
              <div className="flex items-center justify-center h-[260px] text-on-surface-variant text-sm">
                Aucune donnée TES disponible
              </div>
            ) : progressionMode === "pcs" && progressionDataPcs.length === 0 ? (
              <div className="flex items-center justify-center h-[260px] text-on-surface-variant text-sm">
                Aucune donnée PCS disponible
              </div>
            ) : progressionMode === "result" ? (
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={progressionDataResult} margin={{ top: 4, right: 8, left: -16, bottom: 4 }}>
                  <CartesianGrid vertical={false} stroke="#e0e3e5" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 10, fontFamily: "Inter, sans-serif", fill: "#41484d" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fontFamily: "monospace", fill: "#41484d" }}
                    axisLine={false}
                    tickLine={false}
                    domain={["auto", "auto"]}
                  />
                  <Tooltip
                    formatter={(value: number) => [value?.toFixed(2), "Total"]}
                    labelFormatter={(label, payload) => {
                      const p = payload?.[0]?.payload;
                      const name = p?.label ?? label;
                      const dateStr = p?.date;
                      if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return name;
                      const formatted = new Date(dateStr + "T00:00:00").toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
                      return `${name}\n${formatted}`;
                    }}
                    labelStyle={{ whiteSpace: "pre-line" }}
                    contentStyle={{
                      fontSize: 11,
                      fontFamily: "Inter, sans-serif",
                      borderRadius: 12,
                      border: "none",
                      boxShadow: "0 1px 4px rgba(0,0,0,0.12)",
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="total"
                    name="Total"
                    stroke="#2e6385"
                    strokeWidth={2.5}
                    dot={{ r: 4, fill: "#2e6385", stroke: "#fff", strokeWidth: 1.5 }}
                    activeDot={{ r: 6 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : progressionMode === "pcs" ? (
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={progressionDataPcs} margin={{ top: 4, right: 8, left: -16, bottom: 4 }}>
                  <CartesianGrid vertical={false} stroke="#e0e3e5" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 10, fontFamily: "Inter, sans-serif", fill: "#41484d" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fontFamily: "monospace", fill: "#41484d" }}
                    axisLine={false}
                    tickLine={false}
                    domain={["auto", "auto"]}
                  />
                  <Tooltip
                    formatter={(value: number) => value?.toFixed(2)}
                    labelFormatter={(label, payload) => {
                      const p = payload?.[0]?.payload;
                      const name = p?.label ?? label;
                      const dateStr = p?.date;
                      if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return name;
                      const formatted = new Date(dateStr + "T00:00:00").toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
                      return `${name}\n${formatted}`;
                    }}
                    labelStyle={{ whiteSpace: "pre-line" }}
                    contentStyle={{
                      fontSize: 11,
                      fontFamily: "Inter, sans-serif",
                      borderRadius: 12,
                      border: "none",
                      boxShadow: "0 1px 4px rgba(0,0,0,0.12)",
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {pcsComponentNames.map((name, i) => (
                    <Line
                      key={name}
                      type="monotone"
                      dataKey={name}
                      name={name}
                      stroke={PCS_COLORS[i % PCS_COLORS.length]}
                      strokeWidth={2}
                      dot={{ r: 3, fill: PCS_COLORS[i % PCS_COLORS.length], stroke: "#fff", strokeWidth: 1.5 }}
                      activeDot={{ r: 5 }}
                      connectNulls={false}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            ) : (
              /* segments + tes share the same dual-line layout */
              <ResponsiveContainer width="100%" height={260}>
                <LineChart
                  data={progressionMode === "tes" ? progressionDataTes : progressionDataSegments}
                  margin={{ top: 4, right: 8, left: -16, bottom: 4 }}
                >
                  <CartesianGrid vertical={false} stroke="#e0e3e5" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 10, fontFamily: "Inter, sans-serif", fill: "#41484d" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fontFamily: "monospace", fill: "#41484d" }}
                    axisLine={false}
                    tickLine={false}
                    domain={["auto", "auto"]}
                  />
                  <Tooltip
                    formatter={(value: number) => value?.toFixed(2)}
                    labelFormatter={(label, payload) => {
                      const p = payload?.[0]?.payload;
                      const name = p?.label ?? label;
                      const dateStr = p?.date;
                      if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return name;
                      const formatted = new Date(dateStr + "T00:00:00").toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
                      return `${name}\n${formatted}`;
                    }}
                    labelStyle={{ whiteSpace: "pre-line" }}
                    contentStyle={{
                      fontSize: 11,
                      fontFamily: "Inter, sans-serif",
                      borderRadius: 12,
                      border: "none",
                      boxShadow: "0 1px 4px rgba(0,0,0,0.12)",
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line
                    type="monotone"
                    dataKey="sp"
                    name="Programme Court"
                    stroke="#2e6385"
                    strokeWidth={2}
                    dot={{ r: 3, fill: "#2e6385", stroke: "#fff", strokeWidth: 1.5 }}
                    activeDot={{ r: 5 }}
                    connectNulls={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="fs"
                    name="Programme Libre"
                    stroke="#7cb9e8"
                    strokeWidth={2}
                    dot={{ r: 3, fill: "#7cb9e8", stroke: "#fff", strokeWidth: 1.5 }}
                    activeDot={{ r: 5 }}
                    connectNulls={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Competition history table */}
          <div className="bg-surface-container-lowest rounded-xl shadow-sm p-6">
            <h2 className="text-base font-extrabold font-headline text-on-surface mb-4">
              Historique des compétitions
            </h2>
            {isLoading ? (
              <Skeleton className="h-40 w-full" />
            ) : historyRows.length === 0 ? (
              <p className="text-on-surface-variant text-sm">
                Aucune compétition enregistrée.
              </p>
            ) : (
              <div className="overflow-x-auto overflow-y-auto max-h-[400px]">
                <table className="w-full min-w-[560px] border-collapse">
                  <thead className="sticky top-0 z-10">
                    <tr className="bg-surface-container-low">
                      {["", "Compétition", "Catégorie", "Rang", "Total", "TES", "PCS", "Date", "Club"].map(
                        (col, i) => (
                          <th
                            key={col || `col-${i}`}
                            className={`text-[10px] font-black uppercase tracking-widest text-on-surface-variant px-3 py-2.5 ${
                              i <= 1 ? "text-left" : "text-right"
                            } ${i === 0 ? "rounded-tl-xl" : ""} ${i === 8 ? "rounded-tr-xl" : ""}`}
                          >
                            {col}
                          </th>
                        )
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {historyRows.map((row, rowIdx) => {
                      const isMultiSegment = row.catResult != null && row.catResult.segment_count > 1;
                      const isCollapsed = !expandedRows.has(row.key);

                      return (
                        <React.Fragment key={row.key}>
                          {/* Overall result row for multi-segment */}
                          {isMultiSegment && row.catResult ? (
                            <tr
                              className={
                                (rowIdx % 2 === 0
                                  ? "bg-surface-container-lowest"
                                  : "bg-surface-container-low/30") +
                                " cursor-pointer select-none hover:bg-surface-container-low/60 transition-colors"
                              }
                              onClick={() => toggleCollapsed(row.key)}
                            >
                              {/* col 0: button (empty for overall row) */}
                              <td className="px-3 py-2" />
                              {/* col 1: competition name */}
                              <td className="px-3 py-2 text-sm text-on-surface">
                                <div className="flex items-center gap-1.5">
                                  <span className="material-symbols-outlined text-sm text-on-surface-variant leading-none">
                                    {isCollapsed ? "chevron_right" : "expand_more"}
                                  </span>
                                  {user?.role === "skater" ? (
                                    <span className="font-medium text-on-surface">
                                      {row.competitionName ?? `#${row.competitionId}`}
                                    </span>
                                  ) : (
                                    <Link
                                      to={`/competitions/${row.competitionId}`}
                                      className="text-primary hover:underline font-medium"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      {row.competitionName ?? `#${row.competitionId}`}
                                    </Link>
                                  )}
                                </div>
                              </td>
                              {/* col 2: category */}
                              <td className="px-3 py-2 text-right text-sm text-on-surface-variant whitespace-nowrap">
                                {row.category ?? "—"}
                              </td>
                              {/* col 3: rank */}
                              <td className="px-3 py-2 text-right">
                                {row.catResult.overall_rank != null ? (
                                  row.catResult.overall_rank <= 3 ? (
                                    <span className="bg-tertiary-container/30 text-on-tertiary-container text-xs font-bold px-2 py-1 rounded-full">
                                      {row.catResult.overall_rank}
                                    </span>
                                  ) : (
                                    <span className="font-mono text-sm text-on-surface">
                                      {row.catResult.overall_rank}
                                    </span>
                                  )
                                ) : (
                                  <span className="text-on-surface-variant text-sm">—</span>
                                )}
                              </td>
                              {/* col 4: total */}
                              <td className="px-3 py-2 text-right font-mono text-sm font-bold text-on-surface">
                                {row.catResult.combined_total?.toFixed(2) ?? "—"}
                              </td>
                              {/* col 5: TES (n/a for overall) */}
                              <td className="px-3 py-2 text-right font-mono text-sm text-on-surface-variant">—</td>
                              {/* col 6: PCS (n/a for overall) */}
                              <td className="px-3 py-2 text-right font-mono text-sm text-on-surface-variant">—</td>
                              {/* col 7: date */}
                              <td className="px-3 py-2 text-right font-mono text-sm text-on-surface-variant whitespace-nowrap">
                                {row.competitionDate ? row.competitionDate.slice(0, 10) : "—"}
                              </td>
                              {/* col 8: club */}
                              <td className="px-3 py-2 text-right text-sm text-on-surface-variant whitespace-nowrap">
                                {row.club ?? "—"}
                              </td>
                            </tr>
                          ) : null}

                          {/* Individual segment rows */}
                          {(!isMultiSegment || !isCollapsed) && row.segmentScores.map((s) => (
                            <tr
                              key={s.id}
                              className={
                                rowIdx % 2 === 0
                                  ? "bg-surface-container-lowest"
                                  : "bg-surface-container-low/30"
                              }
                            >
                              {/* col 0: score card button */}
                              <td className="px-3 py-2 text-left">
                                {s.elements && s.elements.length > 0 && (
                                  <button
                                    onClick={() => setModalScore(s)}
                                    className="inline-flex items-center gap-0.5 text-primary hover:text-primary/80 transition-colors text-[10px] font-bold uppercase tracking-wider"
                                    title="Voir le détail"
                                  >
                                    <span className="material-symbols-outlined text-[14px]">open_in_new</span>
                                  </button>
                                )}
                              </td>
                              {isMultiSegment ? (
                                <>
                                  {/* col 1: segment label */}
                                  <td className="px-3 py-2 text-sm text-on-surface-variant pl-6">
                                    <span className="text-xs text-on-surface-variant/60">
                                      {s.segment}
                                    </span>
                                  </td>
                                  {/* col 2: category (empty) */}
                                  <td className="px-3 py-2" />
                                </>
                              ) : (
                                <>
                                  {/* col 1: competition name */}
                                  <td className="px-3 py-2 text-sm text-on-surface">
                                    {user?.role === "skater" ? (
                                      <span className="font-medium text-on-surface">
                                        {s.competition_name ?? `#${s.competition_id}`}
                                      </span>
                                    ) : (
                                      <Link
                                        to={`/competitions/${s.competition_id}`}
                                        className="text-primary hover:underline font-medium"
                                      >
                                        {s.competition_name ?? `#${s.competition_id}`}
                                      </Link>
                                    )}
                                  </td>
                                  {/* col 2: category */}
                                  <td className="px-3 py-2 text-right text-sm text-on-surface-variant whitespace-nowrap">
                                    {s.category ?? "—"}
                                  </td>
                                </>
                              )}
                              {/* col 3: rank */}
                              <td className="px-3 py-2 text-right">
                                {s.rank != null ? (
                                  !isMultiSegment && s.rank <= 3 ? (
                                    <span className="bg-tertiary-container/30 text-on-tertiary-container text-xs font-bold px-2 py-1 rounded-full">
                                      {s.rank}
                                    </span>
                                  ) : (
                                    <span className="font-mono text-sm text-on-surface-variant">
                                      {s.rank}
                                    </span>
                                  )
                                ) : (
                                  <span className="text-on-surface-variant text-sm">—</span>
                                )}
                              </td>
                              {/* col 4: total */}
                              <td className="px-3 py-2 text-right font-mono text-sm font-bold text-on-surface">
                                {s.total_score?.toFixed(2) ?? "—"}
                              </td>
                              {/* col 5: TES */}
                              <td className="px-3 py-2 text-right font-mono text-sm text-on-surface">
                                {s.technical_score?.toFixed(2) ?? "—"}
                              </td>
                              {/* col 6: PCS */}
                              <td className="px-3 py-2 text-right font-mono text-sm text-on-surface">
                                {s.component_score?.toFixed(2) ?? "—"}
                              </td>
                              {/* col 7: date */}
                              {isMultiSegment ? (
                                <td className="px-3 py-2" />
                              ) : (
                                <td className="px-3 py-2 text-right font-mono text-sm text-on-surface-variant whitespace-nowrap">
                                  {s.competition_date ? s.competition_date.slice(0, 10) : "—"}
                                </td>
                              )}
                              {/* col 8: club */}
                              {isMultiSegment ? (
                                <td className="px-3 py-2" />
                              ) : (
                                <td className="px-3 py-2 text-right text-sm text-on-surface-variant whitespace-nowrap">
                                  {s.skater_club ?? "—"}
                                </td>
                              )}
                            </tr>
                          ))}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* ────────── RIGHT PANEL ────────── */}
        <div className="lg:col-span-1 flex flex-col gap-6">
          {isLoading ? (
            <>
              <Skeleton className="h-[200px] w-full" />
              <Skeleton className="h-28 w-full" />
              <Skeleton className="h-28 w-full" />
              <Skeleton className="h-28 w-full" />
            </>
          ) : hasElements ? (
            <>
              {/* Base value evolution */}
              <div className="bg-surface-container-lowest rounded-xl shadow-sm p-6">
                <h2 className="text-base font-extrabold font-headline text-on-surface mb-4">
                  Valeur de base totale
                </h2>
                <ElementDifficultyChart elements={elements!} />
              </div>

              {/* KPI metrics */}
              {jumpStats && (
                <ElementFamilyCard
                  label="Sauts"
                  percent={jumpStats.precision}
                  leftLabel="Rotations moy."
                  leftValue={jumpStats.avgLevel?.toFixed(2) ?? "—"}
                  rightLabel="GOE moyen"
                  rightValue={formatGoe(jumpStats.avgGoe)}
                  info="Part des sauts ayant reçu un GOE strictement positif, nombre de rotations moyen (l'Axel compte pour un demi-tour de plus, chaque saut d'une combinaison compte) et GOE moyen, sur l'ensemble des compétitions."
                />
              )}
              {spinStats && (
                <ElementFamilyCard
                  label="Pirouettes"
                  percent={spinStats.precision}
                  leftLabel="Niveau moyen"
                  leftValue={spinStats.avgLevel?.toFixed(2) ?? "—"}
                  rightLabel="GOE moyen"
                  rightValue={formatGoe(spinStats.avgGoe)}
                  info="Part des pirouettes ayant reçu un GOE strictement positif, niveau moyen (B = 0.5, sans niveau = 0) et GOE moyen, sur l'ensemble des compétitions."
                />
              )}
              {stepStats && (
                <ElementFamilyCard
                  label="Pas et séquences"
                  percent={stepStats.precision}
                  leftLabel="Niveau moyen"
                  leftValue={stepStats.avgLevel?.toFixed(2) ?? "—"}
                  rightLabel="GOE moyen"
                  rightValue={formatGoe(stepStats.avgGoe)}
                  info="Part des pas et séquences chorégraphiques ayant reçu un GOE strictement positif, niveau moyen (B = 0.5, sans niveau = 0) et GOE moyen."
                />
              )}
            </>
          ) : (
            <div className="bg-surface-container-lowest rounded-xl shadow-sm p-5 border-l-4 border-tertiary">
              <div className="flex items-start gap-3">
                <span className="material-symbols-outlined text-tertiary text-2xl mt-0.5">
                  picture_as_pdf
                </span>
                <div>
                  <p className="font-bold font-headline text-on-surface">
                    Enrichir avec les PDF
                  </p>
                  <p className="text-xs text-on-surface-variant mt-1">
                    Importez les PDFs pour voir l'analyse d'éléments détaillée.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Second row: full-width charts ── */}
      <div className="px-6 pb-10 grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* GOE chart */}
        <div data-tour="analyse-elements" className="lg:col-span-1 bg-surface-container-lowest rounded-xl shadow-sm p-6">
          <h2 className="text-base font-extrabold font-headline text-on-surface mb-4">
            GOE par élément
          </h2>
          {isLoading ? (
            <Skeleton className="h-[280px] w-full" />
          ) : (
            <ElementGOEChart elements={elements ?? []} />
          )}
        </div>

        {/* Element detail panel */}
        <div className="lg:col-span-1 bg-surface-container-lowest rounded-xl shadow-sm p-6">
          <h2 className="text-base font-extrabold font-headline text-on-surface mb-3">
            Détail des éléments
          </h2>
          {sortedScores.length > 0 && (
            <select
              className="bg-surface-container-high rounded-lg px-3 py-2 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary w-full mb-4"
              value={activeScoreId ?? ""}
              onChange={(e) =>
                setSelectedScoreId(e.target.value ? Number(e.target.value) : null)
              }
            >
              {sortedScores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.competition_name ?? "?"} · {s.segment}
                </option>
              ))}
            </select>
          )}
          {isLoading ? (
            <Skeleton className="h-[200px] w-full" />
          ) : (
            <JudgePanel elements={activeScoreElements} />
          )}
        </div>

        {/* PCS radar */}
        <div className="lg:col-span-1 bg-surface-container-lowest rounded-xl shadow-sm p-6">
          <h2 className="text-base font-extrabold font-headline text-on-surface mb-4">
            Composantes PCS
          </h2>
          {isLoading ? (
            <Skeleton className="h-[280px] w-full" />
          ) : (
            <PCSRadarChart scores={scores ?? []} />
          )}
        </div>
      </div>
        </>
      )}

      {/* ── Training content ── */}
      {(analyticsTab === "training" || analyticsTab === "journal") && showTrainingTab && (() => {
        const allReviews = trainingReviews ?? [];
        const allIncidents = trainingIncidents ?? [];
        const allChallenges = trainingChallenges ?? [];
        const latestReview = allReviews[0];
        const today = new Date().toISOString().split("T")[0];
        const activeChallenges = allChallenges.filter((c) => c.target_date >= today);

        const INCIDENT_META: Record<string, { label: string; color: string; icon: string }> = {
          injury: { label: "Blessure", color: "text-error", icon: "healing" },
          behavior: { label: "Comportement", color: "text-orange-600", icon: "report" },
          other: { label: "Autre", color: "text-on-surface-variant", icon: "info" },
        };

        const RATING_TIPS: Record<string, string> = {
          engagement: "Implication et motivation lors des entraînements : concentration, volonté de progresser, participation active aux exercices.",
          progression: "Évolution technique constatée : acquisition de nouveaux éléments, amélioration de la qualité d'exécution.",
          attitude: "Comportement général : respect des consignes, esprit d'équipe, ponctualité, relation avec les autres patineurs.",
        };

        const TRAINING_TABS = [
          ...(user?.role === "skater" ? [{ key: "journal" as const, label: "Journal", icon: "auto_stories" }] : []),
          { key: "reviews" as const, label: "Retours", icon: "rate_review" },
          { key: "challenges" as const, label: "Défis", icon: "flag" },
          { key: "incidents" as const, label: "Incidents", icon: "warning" },
          { key: "evolution" as const, label: "Évolution", icon: "trending_up" },
        ];

        return (
          <div className="p-6 space-y-6" data-tour="analyse-training">
            {/* Featured cards: latest review + active challenges */}
            {(latestReview || activeChallenges.length > 0) && (
              <div className="space-y-3">
                {latestReview && (
                  <div className="bg-surface-container-low rounded-2xl p-5 space-y-3">
                    <h4 className="font-headline font-bold text-on-surface text-sm">
                      Semaine du {new Date(latestReview.week_start).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}
                    </h4>
                    <div className="grid grid-cols-3 gap-4">
                      {(["engagement", "progression", "attitude"] as const).map((field) => (
                        <div key={field}>
                          <span className="inline-flex items-center gap-1">
                            <span className="text-[10px] uppercase tracking-wider text-on-surface-variant capitalize">{field}</span>
                            <span className="material-symbols-outlined text-on-surface-variant text-xs cursor-help" title={RATING_TIPS[field]}>info</span>
                          </span>
                          <div className="flex gap-0.5">
                            {Array.from({ length: 5 }, (_, i) => (
                              <div key={i} className={`w-2.5 h-2.5 rounded-full ${i < latestReview[field] ? "bg-primary" : "bg-surface-container"}`} />
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                    {latestReview.strengths && (
                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-on-surface-variant mb-0.5">Points forts</p>
                        <p className="text-sm text-on-surface">{latestReview.strengths}</p>
                      </div>
                    )}
                    {latestReview.improvements && (
                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-on-surface-variant mb-0.5">Axes d'amélioration</p>
                        <p className="text-sm text-on-surface">{latestReview.improvements}</p>
                      </div>
                    )}
                  </div>
                )}
                {activeChallenges.map((c) => (
                  <div key={c.id} className="bg-surface-container-low rounded-2xl p-5 space-y-3 ring-1 ring-primary/20">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="material-symbols-outlined text-lg text-primary">flag</span>
                        <span className="text-[10px] uppercase tracking-wider font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-full">En cours</span>
                      </div>
                      <span className="text-xs text-on-surface-variant">
                        Échéance : {new Date(c.target_date).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}
                      </span>
                    </div>
                    <p className="text-sm text-on-surface">{c.objective}</p>
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-on-surface-variant mb-1">Atteinte</p>
                      <div className="flex gap-0.5">
                        {Array.from({ length: 5 }, (_, i) => (
                          <div key={i} className={`w-2.5 h-2.5 rounded-full ${i < c.score ? "bg-primary" : "bg-surface-container"}`} />
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Sub-tabs */}
            <div className="flex gap-0">
              {TRAINING_TABS.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => { setTrainingSubTab(tab.key); window.scrollTo(0, 0); }}
                  className={`px-5 py-2 text-sm font-semibold transition-colors border-b-2 ${
                    trainingSubTab === tab.key
                      ? "text-primary border-primary"
                      : "text-on-surface-variant border-transparent hover:text-on-surface"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Reviews tab */}
            {trainingSubTab === "reviews" && (
              allReviews.length === 0 ? (
                <p className="text-sm text-on-surface-variant text-center py-10">Aucun retour pour le moment</p>
              ) : (
                <div className="divide-y divide-outline-variant/20">
                  {allReviews.map((r) => {
                    const weekDate = new Date(r.week_start).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
                    const avg = ((r.engagement + r.progression + r.attitude) / 3).toFixed(1);
                    const hasText = !!(r.strengths || r.improvements);
                    return (
                      <button
                        key={r.id}
                        onClick={() => setViewingReview(r)}
                        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-surface-container-low transition-colors text-left"
                      >
                        <span className="text-xs text-on-surface-variant w-16 shrink-0">{weekDate}</span>
                        {r.coach_name && (
                          <span className="text-[11px] text-on-surface-variant truncate max-w-[6rem] shrink-0">{r.coach_name}</span>
                        )}
                        <div className="flex gap-2 shrink-0">
                          {(["engagement", "progression", "attitude"] as const).map((field) => (
                            <div key={field} className="flex gap-0.5">
                              {Array.from({ length: 5 }, (_, i) => (
                                <div key={i} className={`w-1.5 h-1.5 rounded-full ${i < r[field] ? "bg-primary" : "bg-surface-container"}`} />
                              ))}
                            </div>
                          ))}
                        </div>
                        <span className="font-mono text-xs text-primary font-bold w-8 shrink-0">{avg}</span>
                        {hasText && (
                          <p className="text-xs text-on-surface-variant truncate flex-1 min-w-0">
                            {r.strengths || r.improvements}
                          </p>
                        )}
                      </button>
                    );
                  })}
                </div>
              )
            )}

            {/* Challenges tab */}
            {trainingSubTab === "challenges" && (
              allChallenges.length === 0 ? (
                <p className="text-sm text-on-surface-variant text-center py-10">Aucun défi pour le moment</p>
              ) : (
                <div className="divide-y divide-outline-variant/20">
                  {allChallenges.map((c) => {
                    const isActive = c.target_date >= today;
                    const targetDate = new Date(c.target_date).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
                    return (
                      <button
                        key={c.id}
                        onClick={() => setViewingChallenge(c)}
                        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-surface-container-low transition-colors text-left"
                      >
                        <span className={`material-symbols-outlined text-sm ${isActive ? "text-primary" : "text-on-surface-variant"}`}>flag</span>
                        <span className="text-xs text-on-surface-variant w-16 shrink-0">{targetDate}</span>
                        <div className="flex gap-0.5 shrink-0">
                          {Array.from({ length: 5 }, (_, i) => (
                            <div key={i} className={`w-1.5 h-1.5 rounded-full ${i < c.score ? "bg-primary" : "bg-surface-container"}`} />
                          ))}
                        </div>
                        <p className="text-xs text-on-surface truncate flex-1 min-w-0">{c.objective}</p>
                      </button>
                    );
                  })}
                </div>
              )
            )}

            {/* Incidents tab */}
            {trainingSubTab === "incidents" && (
              allIncidents.length === 0 ? (
                <p className="text-sm text-on-surface-variant text-center py-10">Aucun incident signalé</p>
              ) : (
                <div className="divide-y divide-outline-variant/20">
                  {allIncidents.map((inc) => {
                    const meta = INCIDENT_META[inc.incident_type] ?? INCIDENT_META.other;
                    const dateStr = new Date(inc.date).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
                    return (
                      <button
                        key={inc.id}
                        onClick={() => setViewingIncident(inc)}
                        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-surface-container-low transition-colors text-left"
                      >
                        <span className={`material-symbols-outlined text-sm ${meta.color}`}>{meta.icon}</span>
                        <span className="text-xs text-on-surface-variant w-16 shrink-0">{dateStr}</span>
                        <span className={`text-xs font-bold shrink-0 ${meta.color}`}>{meta.label}</span>
                        <p className="text-xs text-on-surface-variant truncate flex-1 min-w-0">{inc.description}</p>
                      </button>
                    );
                  })}
                </div>
              )
            )}

            {/* Evolution tab */}
            {trainingSubTab === "evolution" && (
              <TrainingEvolutionChart
                reviews={allReviews}
                incidents={allIncidents}
              />
            )}

            {/* Journal tab (skater self-eval) */}
            {trainingSubTab === "journal" && user?.role === "skater" && (() => {
              const todayEvals = (selfEvalsToday ?? []);

              return (
              <div className="space-y-4" data-tour="analyse-journal">
                <MoodInput skaterId={skaterId} today={selfEvalToday} />

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="bg-surface-container-lowest rounded-xl shadow-sm p-5" data-tour="analyse-autoeval">
                    <p className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant mb-3">
                      Auto-evaluations du jour
                    </p>
                    {todayEvals.length > 0 && (
                      <div className="space-y-2 mb-3">
                        {todayEvals.map((ev) => (
                          <button
                            key={ev.id}
                            onClick={() => { setEditingEval(ev); setShowEvalModal(true); }}
                            className="w-full flex items-center gap-2 text-left bg-surface-container-low rounded-lg px-3 py-2 hover:bg-surface-container transition-colors"
                          >
                            <span className="material-symbols-outlined text-primary text-sm">edit_note</span>
                            <span className="text-xs text-on-surface truncate flex-1">
                              {ev.notes || "Evaluation"}
                            </span>
                            <span className="material-symbols-outlined text-on-surface-variant text-sm">chevron_right</span>
                          </button>
                        ))}
                      </div>
                    )}
                    <button
                      onClick={() => { setEditingEval(undefined); setShowEvalModal(true); }}
                      className="bg-primary text-on-primary rounded-lg px-5 py-2.5 text-xs font-bold active:scale-95 transition-all w-full"
                    >
                      Nouvelle evaluation
                    </button>
                  </div>
                  <ProgramEditor skaterId={skaterId} />
                </div>

                <TrainingJournal
                  skaterId={skaterId}
                  weekStart={weekStart}
                  weekEnd={weekEnd}
                  onEditEval={(ev) => { setEditingEval(ev); setShowEvalModal(true); }}
                />
              </div>
              );
            })()}

            {/* Self-eval modal */}
            {showEvalModal && (
              <SelfEvalModal
                skaterId={skaterId}
                today={selfEvalToday}
                existingEval={editingEval}
                onClose={() => { setShowEvalModal(false); setEditingEval(undefined); }}
              />
            )}

            {/* Detail modals (read-only) */}
            {viewingReview && (
              <div className="fixed inset-0 bg-scrim/50 z-50 flex items-center justify-center p-4" onClick={() => setViewingReview(undefined)}>
                <div className="bg-surface rounded-3xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto space-y-4" onClick={(e) => e.stopPropagation()}>
                  <div>
                    <h3 className="font-headline font-bold text-on-surface text-lg">
                      Semaine du {new Date(viewingReview.week_start).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}
                    </h3>
                    {viewingReview.coach_name && (
                      <p className="text-xs text-on-surface-variant">par {viewingReview.coach_name}</p>
                    )}
                  </div>
                  <div className="grid grid-cols-3 gap-4">
                    {(["engagement", "progression", "attitude"] as const).map((field) => (
                      <div key={field}>
                        <span className="inline-flex items-center gap-1">
                          <span className="text-[10px] uppercase tracking-wider text-on-surface-variant capitalize">{field}</span>
                          <span className="material-symbols-outlined text-on-surface-variant text-xs cursor-help" title={RATING_TIPS[field]}>info</span>
                        </span>
                        <div className="flex gap-0.5">
                          {Array.from({ length: 5 }, (_, i) => (
                            <div key={i} className={`w-2.5 h-2.5 rounded-full ${i < viewingReview[field] ? "bg-primary" : "bg-surface-container"}`} />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                  {viewingReview.strengths && (
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-on-surface-variant mb-0.5">Points forts</p>
                      <p className="text-sm text-on-surface">{viewingReview.strengths}</p>
                    </div>
                  )}
                  {viewingReview.improvements && (
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-on-surface-variant mb-0.5">Axes d'amélioration</p>
                      <p className="text-sm text-on-surface">{viewingReview.improvements}</p>
                    </div>
                  )}
                  <div className="flex justify-end pt-2">
                    <button onClick={() => setViewingReview(undefined)} className="py-2 px-4 rounded-xl text-sm font-bold text-on-surface-variant hover:bg-surface-container transition-colors">
                      Fermer
                    </button>
                  </div>
                </div>
              </div>
            )}

            {viewingChallenge && (() => {
              const isActive = viewingChallenge.target_date >= today;
              return (
                <div className="fixed inset-0 bg-scrim/50 z-50 flex items-center justify-center p-4" onClick={() => setViewingChallenge(undefined)}>
                  <div className="bg-surface rounded-3xl p-6 w-full max-w-lg space-y-4" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-2">
                      <span className={`material-symbols-outlined text-lg ${isActive ? "text-primary" : "text-on-surface-variant"}`}>flag</span>
                      <h3 className="font-headline font-bold text-on-surface text-lg">Défi</h3>
                      {isActive && (
                        <span className="text-[10px] uppercase tracking-wider font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-full">En cours</span>
                      )}
                    </div>
                    <p className="text-sm text-on-surface">{viewingChallenge.objective}</p>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-on-surface-variant mb-1">Atteinte</p>
                        <div className="flex gap-0.5">
                          {Array.from({ length: 5 }, (_, i) => (
                            <div key={i} className={`w-2.5 h-2.5 rounded-full ${i < viewingChallenge.score ? "bg-primary" : "bg-surface-container"}`} />
                          ))}
                        </div>
                      </div>
                      <span className="text-xs text-on-surface-variant">
                        Échéance : {new Date(viewingChallenge.target_date).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}
                      </span>
                    </div>
                    <div className="flex justify-end pt-2">
                      <button onClick={() => setViewingChallenge(undefined)} className="py-2 px-4 rounded-xl text-sm font-bold text-on-surface-variant hover:bg-surface-container transition-colors">
                        Fermer
                      </button>
                    </div>
                  </div>
                </div>
              );
            })()}

            {viewingIncident && (() => {
              const meta = INCIDENT_META[viewingIncident.incident_type] ?? INCIDENT_META.other;
              return (
                <div className="fixed inset-0 bg-scrim/50 z-50 flex items-center justify-center p-4" onClick={() => setViewingIncident(undefined)}>
                  <div className="bg-surface rounded-3xl p-6 w-full max-w-lg space-y-4" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-2">
                      <span className={`material-symbols-outlined text-lg ${meta.color}`}>{meta.icon}</span>
                      <h3 className="font-headline font-bold text-on-surface text-lg">{meta.label}</h3>
                    </div>
                    <p className="text-xs text-on-surface-variant">
                      {new Date(viewingIncident.date).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}
                    </p>
                    <p className="text-sm text-on-surface">{viewingIncident.description}</p>
                    <div className="flex justify-end pt-2">
                      <button onClick={() => setViewingIncident(undefined)} className="py-2 px-4 rounded-xl text-sm font-bold text-on-surface-variant hover:bg-surface-container transition-colors">
                        Fermer
                      </button>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        );
      })()}
    </div>
  );
}
