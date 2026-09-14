import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  api,
  type TeamScoresResponse,
  type TeamDivisionClub,
  type TeamSkaterEntry,
  type TeamViolation,
} from "../api/client";
import { useAuth } from "../auth/AuthContext";
import MediansModal from "./MediansModal";

type SubTab = "challenge" | "D1" | "D2" | "D3" | "categories";

// --- Violation helpers ---

/** Build lookup sets from violations for quick checks. */
function useViolationIndex(violations: TeamViolation[]) {
  return useMemo(() => {
    // (club, division, category) -> violations for category-level errors
    const byCatKey = new Map<string, TeamViolation[]>();
    // (club, division) -> violations for division-level errors
    const byDivKey = new Map<string, TeamViolation[]>();
    // club -> true for any violation
    const byClub = new Set<string>();

    for (const v of violations) {
      byClub.add(v.club);

      const divKey = `${v.club}\0${v.division}`;
      if (!byDivKey.has(divKey)) byDivKey.set(divKey, []);
      byDivKey.get(divKey)!.push(v);

      if (v.category) {
        const catKey = `${v.club}\0${v.division}\0${v.category}`;
        if (!byCatKey.has(catKey)) byCatKey.set(catKey, []);
        byCatKey.get(catKey)!.push(v);
      }
    }

    return { byCatKey, byDivKey, byClub };
  }, [violations]);
}

function ErrorIcon({ title }: { title?: string }) {
  return (
    <span
      className="material-symbols-outlined text-error text-base align-middle"
      title={title}
    >
      error
    </span>
  );
}

// --- Shared components ---

function TitularCheckbox({
  s,
  competitionId,
}: {
  s: TeamSkaterEntry;
  competitionId: number;
}) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (isTitular: boolean) =>
      api.competitions.updateTitular(competitionId, s.score_id, isTitular),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["team-scores", competitionId] });
    },
  });

  return (
    <input
      type="checkbox"
      checked={s.is_titular}
      onChange={(e) => mutation.mutate(e.target.checked)}
      disabled={mutation.isPending}
      className="w-4 h-4 rounded accent-primary cursor-pointer disabled:opacity-50"
      title={s.is_titular ? "Titulaire" : "Remplaçant"}
    />
  );
}

function SkaterRow({
  s,
  isAdmin,
  competitionId,
}: {
  s: TeamSkaterEntry;
  isAdmin: boolean;
  competitionId: number;
}) {
  return (
    <tr className={`border-t border-gray-100 ${s.is_remplacant ? "opacity-50" : ""}`}>
      {isAdmin && (
        <td className="px-2 py-1.5 text-center">
          <TitularCheckbox s={s} competitionId={competitionId} />
        </td>
      )}
      <td className="px-3 py-1.5">
        <Link
          to={`/patineurs/${s.skater_id}/analyse`}
          className="hover:text-primary transition-colors"
        >
          {s.skater_name}
        </Link>
        {s.is_remplacant && (
          <span className="ml-2 text-[10px] font-bold uppercase tracking-wider bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded-full">
            Rempl.
          </span>
        )}
      </td>
      <td className="px-3 py-1.5 text-gray-500 text-xs max-w-[160px] truncate">{s.category ?? "\u2014"}</td>
      <td className="px-3 py-1.5 text-right font-mono">{s.total_score?.toFixed(2) ?? "\u2014"}</td>
      <td className="px-3 py-1.5 text-right font-mono text-gray-400 text-xs">
        {s.median_value?.toFixed(2) ?? "\u2014"}
      </td>
      <td className="px-3 py-1.5 text-right font-mono font-bold">
        {s.is_remplacant ? (
          <span className="text-gray-400">{"\u2014"}</span>
        ) : (
          s.points?.toFixed(2) ?? "\u2014"
        )}
      </td>
    </tr>
  );
}

function RankBadge({ rank }: { rank: number }) {
  return (
    <span
      className={`w-8 h-8 flex items-center justify-center rounded-full font-bold text-sm ${
        rank === 1
          ? "bg-amber-100 text-amber-800"
          : rank === 2
          ? "bg-gray-200 text-gray-700"
          : rank === 3
          ? "bg-orange-100 text-orange-800"
          : "bg-gray-100 text-gray-600"
      }`}
    >
      {rank}
    </span>
  );
}

// --- Division view ---

function DivisionClubCard({
  club,
  isAdmin,
  competitionId,
  violations,
}: {
  club: TeamDivisionClub;
  isAdmin: boolean;
  competitionId: number;
  violations: TeamViolation[];
}) {
  const [expanded, setExpanded] = useState(false);
  const hasViolations = violations.length > 0;

  return (
    <div className={`bg-white rounded-xl shadow-sm overflow-hidden ${hasViolations ? "ring-1 ring-error/30" : ""}`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-4 px-4 py-3 hover:bg-gray-50 transition-colors text-left"
      >
        <RankBadge rank={club.rank} />
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-on-surface truncate flex items-center gap-1.5">
            {club.club}
            {hasViolations && <ErrorIcon title={violations.map((v) => v.message).join(" ; ")} />}
          </p>
          <p className="text-xs text-on-surface-variant">
            {club.skater_count} patineur{club.skater_count > 1 ? "s" : ""} comptabilise{club.skater_count > 1 ? "s" : ""}
          </p>
        </div>
        <span className="font-mono font-bold text-lg text-primary">
          {club.total_points.toFixed(2)}
        </span>
        <span
          className="material-symbols-outlined text-gray-400 transition-transform"
          style={{ transform: expanded ? "rotate(180deg)" : "rotate(0deg)" }}
        >
          expand_more
        </span>
      </button>

      {expanded && (
        <>
          {hasViolations && (
            <div className="px-4 py-2 bg-error/5 text-error text-xs">
              {violations.map((v, i) => (
                <p key={i} className="flex items-center gap-1">
                  <span className="material-symbols-outlined text-sm">error</span>
                  {v.category ? `${v.category} : ` : ""}{v.message}
                </p>
              ))}
            </div>
          )}
          <div className="border-t overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs text-gray-500 uppercase tracking-wider">
                <tr>
                  {isAdmin && <th className="px-2 py-2 text-center w-10">Tit.</th>}
                  <th className="px-3 py-2">Patineur</th>
                  <th className="px-3 py-2">Categorie</th>
                  <th className="px-3 py-2 text-right">Score</th>
                  <th className="px-3 py-2 text-right">Mediane</th>
                  <th className="px-3 py-2 text-right">Points</th>
                </tr>
              </thead>
              <tbody>
                {club.skaters.map((s) => (
                  <SkaterRow key={s.score_id} s={s} isAdmin={isAdmin} competitionId={competitionId} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// --- Challenge view ---

function ChallengeView({
  data,
  clubsWithViolations,
}: {
  data: TeamScoresResponse;
  clubsWithViolations: Set<string>;
}) {
  const divisions = Object.keys(data.division_rankings).sort();

  return (
    <div className="space-y-3">
      {data.challenge.length === 0 ? (
        <p className="text-gray-500">Aucun resultat disponible.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm bg-white rounded-xl shadow-sm">
            <thead className="bg-gray-50 text-left text-xs text-gray-500 uppercase tracking-wider">
              <tr>
                <th className="px-3 py-2.5 w-12">Rang</th>
                <th className="px-3 py-2.5">Club</th>
                {divisions.map((div) => (
                  <th key={`rank-${div}`} className="px-3 py-2.5 text-center">
                    Rg {div}
                  </th>
                ))}
                {divisions.map((div) => (
                  <th key={`pts-${div}`} className="px-3 py-2.5 text-right">
                    Pts {div}
                  </th>
                ))}
                <th className="px-3 py-2.5 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {data.challenge.map((ch) => (
                <tr key={ch.club} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-3 py-2.5">
                    <RankBadge rank={ch.rank} />
                  </td>
                  <td className="px-3 py-2.5 font-semibold">
                    <span className="flex items-center gap-1.5">
                      {ch.club}
                      {clubsWithViolations.has(ch.club) && (
                        <ErrorIcon title="Equipe non conforme" />
                      )}
                    </span>
                  </td>
                  {divisions.map((div) => (
                    <td key={`rank-${div}`} className="px-3 py-2.5 text-center font-mono text-gray-500">
                      {ch.division_ranks[div] != null ? (
                        <span>{ch.division_ranks[div]}</span>
                      ) : (
                        <span className="text-gray-300">{"\u2014"}</span>
                      )}
                    </td>
                  ))}
                  {divisions.map((div) => (
                    <td key={`pts-${div}`} className="px-3 py-2.5 text-right font-mono">
                      {ch.division_points[div] != null ? (
                        ch.division_points[div]
                      ) : (
                        <span className="text-gray-300">{"\u2014"}</span>
                      )}
                    </td>
                  ))}
                  <td className="px-3 py-2.5 text-right font-mono font-bold text-primary text-lg">
                    {ch.challenge_points}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// --- Division tab ---

function DivisionView({
  division,
  data,
  isAdmin,
  competitionId,
  violationsByDiv,
}: {
  division: string;
  data: TeamScoresResponse;
  isAdmin: boolean;
  competitionId: number;
  violationsByDiv: Map<string, TeamViolation[]>;
}) {
  const clubs = data.division_rankings[division] ?? [];

  if (clubs.length === 0) {
    return <p className="text-gray-500">Aucun resultat pour la {division}.</p>;
  }

  return (
    <div className="space-y-3">
      {clubs.map((club) => {
        const divKey = `${club.club}\0${division}`;
        const clubViolations = violationsByDiv.get(divKey) ?? [];
        return (
          <DivisionClubCard
            key={club.club}
            club={club}
            isAdmin={isAdmin}
            competitionId={competitionId}
            violations={clubViolations}
          />
        );
      })}
    </div>
  );
}

// --- Categories view ---

function CategoriesView({
  data,
  isAdmin,
  competitionId,
  violationsByCat,
}: {
  data: TeamScoresResponse;
  isAdmin: boolean;
  competitionId: number;
  violationsByCat: Map<string, TeamViolation[]>;
}) {
  return (
    <div className="space-y-4">
      {data.categories.map((cat) => {
        // Check if any club has violations for this category
        const catViolations: TeamViolation[] = [];
        for (const [key, vs] of violationsByCat.entries()) {
          if (key.endsWith(`\0${cat.category}`)) {
            catViolations.push(...vs);
          }
        }
        const hasViolation = catViolations.length > 0;

        return (
          <div
            key={cat.category}
            className={`bg-white rounded-xl shadow-sm overflow-hidden ${hasViolation ? "ring-1 ring-error/30" : ""}`}
          >
            <div
              className={`px-4 py-2 flex items-center justify-between ${
                hasViolation ? "bg-error/5" : "bg-gray-50"
              }`}
            >
              <span className={`font-medium text-sm flex items-center gap-1.5 ${hasViolation ? "text-error" : ""}`}>
                {hasViolation && <ErrorIcon />}
                {cat.category}
              </span>
              <span className={`text-xs ${hasViolation ? "text-error/70" : "text-gray-500"}`}>
                {cat.division && `${cat.division} \u00b7 `}
                Mediane : {cat.median_value?.toFixed(2) ?? "\u2014"}
              </span>
            </div>
            {hasViolation && (
              <div className="px-4 py-1.5 bg-error/5 text-error text-xs border-t border-error/10">
                {catViolations.map((v, i) => (
                  <p key={i} className="flex items-center gap-1">
                    <span className="material-symbols-outlined text-sm">error</span>
                    {v.club} : {v.message}
                  </p>
                ))}
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-gray-500 uppercase tracking-wider">
                  <tr>
                    {isAdmin && <th className="px-2 py-2 text-center w-10">Tit.</th>}
                    <th className="px-3 py-2">Rang</th>
                    <th className="px-3 py-2">Patineur</th>
                    <th className="px-3 py-2">Club</th>
                    <th className="px-3 py-2 text-right">Score</th>
                    <th className="px-3 py-2 text-right">Points</th>
                  </tr>
                </thead>
                <tbody>
                  {cat.skaters
                    .sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999))
                    .map((s) => (
                      <tr
                        key={s.score_id}
                        className={`border-t border-gray-100 ${s.is_remplacant ? "opacity-50" : ""}`}
                      >
                        {isAdmin && (
                          <td className="px-2 py-1.5 text-center">
                            <TitularCheckbox s={s} competitionId={competitionId} />
                          </td>
                        )}
                        <td className="px-3 py-1.5">{s.rank ?? "\u2014"}</td>
                        <td className="px-3 py-1.5">
                          <Link
                            to={`/patineurs/${s.skater_id}/analyse`}
                            className="hover:text-primary transition-colors"
                          >
                            {s.skater_name}
                          </Link>
                          {s.is_remplacant && (
                            <span className="ml-2 text-[10px] font-bold uppercase tracking-wider bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded-full">
                              Rempl.
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-gray-600 max-w-[160px] truncate">{s.club}</td>
                        <td className="px-3 py-1.5 text-right font-mono">
                          {s.total_score?.toFixed(2) ?? "\u2014"}
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono font-bold">
                          {s.is_remplacant ? "\u2014" : (s.points?.toFixed(2) ?? "\u2014")}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// --- Sub-tab navigation ---

const SUB_TABS: { key: SubTab; label: string; icon?: string }[] = [
  { key: "challenge", label: "Challenge", icon: "emoji_events" },
  { key: "D1", label: "Division 1" },
  { key: "D2", label: "Division 2" },
  { key: "D3", label: "Division 3" },
  { key: "categories", label: "Categories", icon: "category" },
];

// --- Main component ---

export default function TeamScoresTab({ competitionId }: { competitionId: number }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isAdmin = user?.role === "admin";
  const [showMedians, setShowMedians] = useState(false);
  const [subTab, setSubTab] = useState<SubTab>("challenge");

  const { data, isLoading, error } = useQuery({
    queryKey: ["team-scores", competitionId],
    queryFn: () => api.competitions.teamScores(competitionId),
  });

  const reimportMutation = useMutation({
    mutationFn: async () => {
      const job = await api.competitions.reimport(competitionId);
      // Poll until the job finishes
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const updated = await api.jobs.get(job.id);
        if (updated.status === "completed" || updated.status === "failed") return updated;
      }
      return job;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["team-scores", competitionId] });
    },
  });

  const saveMedians = useMutation({
    mutationFn: (medians: Record<string, Record<string, number>>) =>
      api.competitions.updateTeamMedians(competitionId, medians),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["team-scores", competitionId] });
      setShowMedians(false);
    },
  });

  const resetTitular = useMutation({
    mutationFn: () => api.competitions.resetTitular(competitionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["team-scores", competitionId] });
    },
  });

  const { byCatKey, byDivKey, byClub } = useViolationIndex(data?.violations ?? []);

  if (isLoading) return <p className="text-gray-500 py-4">Chargement...</p>;
  if (error) return <p className="text-red-600 py-4">Erreur lors du chargement des scores.</p>;
  if (!data) return null;

  // Only show division tabs that have data
  const availableDivisions = Object.keys(data.division_rankings).sort();
  const visibleTabs = SUB_TABS.filter(
    (t) => t.key === "challenge" || t.key === "categories" || availableDivisions.includes(t.key)
  );

  return (
    <div data-tour="competition-equipe" className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Score equipe</h2>
          <p className="text-xs text-on-surface-variant">
            Medianes : {data.medians_source === "competition" ? "specifiques a cette competition" : "valeurs par defaut de la saison"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Refresh button + timestamp */}
          <span className="text-xs text-on-surface-variant">
            {data.last_import_at
              ? new Date(data.last_import_at).toLocaleString("fr-FR", {
                  day: "2-digit",
                  month: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : "Jamais importe"}
          </span>
          <button
            onClick={() => reimportMutation.mutate()}
            disabled={reimportMutation.isPending}
            className="flex items-center justify-center w-8 h-8 rounded-full bg-surface-container hover:bg-surface-container-high transition-colors text-on-surface-variant disabled:opacity-50"
            title="Rafraichir l'import"
          >
            <span className={`material-symbols-outlined text-lg ${reimportMutation.isPending ? "animate-spin" : ""}`}>
              refresh
            </span>
          </button>
          {isAdmin && (
            <>
              <button
                onClick={() => {
                  if (confirm("Reinitialiser les titulaires (6 premiers par division/club) ?")) {
                    resetTitular.mutate();
                  }
                }}
                disabled={resetTitular.isPending}
                className="flex items-center gap-1 text-sm px-3 py-1.5 rounded-xl bg-surface-container hover:bg-surface-container-high transition-colors text-on-surface-variant disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-base">restart_alt</span>
                Titulaires
              </button>
              <button
                onClick={() => setShowMedians(true)}
                className="flex items-center gap-1 text-sm px-3 py-1.5 rounded-xl bg-surface-container hover:bg-surface-container-high transition-colors text-on-surface-variant"
              >
                <span className="material-symbols-outlined text-base">tune</span>
                Medianes
              </button>
            </>
          )}
        </div>
      </div>

      {/* Sub-tabs */}
      <nav className="flex gap-1 flex-wrap">
        {visibleTabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setSubTab(t.key)}
            className={`flex items-center gap-1 text-sm px-3 py-1.5 rounded-full transition-colors ${
              subTab === t.key
                ? "bg-primary text-white"
                : "bg-surface-container text-on-surface-variant hover:bg-surface-container-high"
            }`}
          >
            {t.icon && <span className="material-symbols-outlined text-base">{t.icon}</span>}
            {t.label}
          </button>
        ))}
      </nav>

      {/* Unmapped categories warning */}
      {data.unmapped.length > 0 && (
        <div className="bg-amber-50 text-amber-800 text-sm px-4 py-3 rounded-xl">
          <p className="font-semibold mb-1">Categories sans mediane associee :</p>
          <ul className="list-disc list-inside text-xs">
            {data.unmapped.map((u) => (
              <li key={u}>{u}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Tab content */}
      {subTab === "challenge" && (
        <ChallengeView data={data} clubsWithViolations={byClub} />
      )}
      {(subTab === "D1" || subTab === "D2" || subTab === "D3") && (
        <DivisionView
          division={subTab}
          data={data}
          isAdmin={isAdmin}
          competitionId={competitionId}
          violationsByDiv={byDivKey}
        />
      )}
      {subTab === "categories" && (
        <CategoriesView
          data={data}
          isAdmin={isAdmin}
          competitionId={competitionId}
          violationsByCat={byCatKey}
        />
      )}

      {/* Medians modal */}
      {showMedians && (
        <MediansModal
          medians={data.medians}
          onSave={(m) => saveMedians.mutate(m)}
          onClose={() => setShowMedians(false)}
          saving={saveMedians.isPending}
          title="Medianes de la competition"
        />
      )}
    </div>
  );
}
