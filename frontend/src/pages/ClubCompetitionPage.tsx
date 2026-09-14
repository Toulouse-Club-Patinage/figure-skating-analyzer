import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import ClubTabBar from "../components/ClubTabBar";
import { api, CompetitionClubAnalysis } from "../api/client";
import CategoryBreakdownModal from "../components/CategoryBreakdownModal";

export default function ClubCompetitionPage() {
  const [selectedSeason, setSelectedSeason] = useState<string>("");
  const [selectedCompId, setSelectedCompId] = useState<number | null>(null);
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  /** Vrai dès que l'utilisateur choisit une saison dans le sélecteur. Le repli
   *  automatique vers une saison plus ancienne s'arrête alors définitivement :
   *  une saison vide choisie sciemment doit rester affichée telle quelle. */
  const [seasonPicked, setSeasonPicked] = useState(false);

  const { data: seasons = [] } = useQuery({
    queryKey: ["seasons"],
    queryFn: api.competitions.seasons,
  });

  const season = selectedSeason || seasons[0] || "";

  const { data: competitions = [], isFetched: competitionsFetched } = useQuery({
    queryKey: ["club-competitions", season],
    queryFn: () => api.competitions.list({ season, my_club: true }),
    enabled: !!season,
  });

  // Présélection de la compétition la plus récente : sans elle la page s'ouvre
  // vide, ce qui oblige à un clic avant de voir quoi que ce soit et prive le
  // tutoriel de ses ancres. La liste arrive triée par date décroissante, d'où
  // `competitions[0]`. L'effet se rejoue à chaque nouvelle liste, donc aussi
  // après un changement de saison (qui remet la sélection à zéro) ; la garde
  // sur `selectedCompId` préserve un choix manuel.
  useEffect(() => {
    if (selectedCompId === null && competitions.length > 0) {
      setSelectedCompId(competitions[0].id);
    }
  }, [competitions, selectedCompId]);

  // Saison courante sans aucune compétition du club : on recule vers la saison
  // précédente qui en a une, plutôt que de laisser la page vide en début de
  // saison. `seasons` arrive trié du plus récent au plus ancien, donc reculer
  // c'est avancer d'un cran dans le tableau. Ce repli ne vaut que tant que
  // l'utilisateur n'a pas choisi de saison lui-même : s'il en sélectionne une
  // vide sciemment, on l'y laisse.
  useEffect(() => {
    if (seasonPicked || !competitionsFetched || competitions.length > 0) return;
    const next = seasons[seasons.indexOf(season) + 1];
    if (next) setSelectedSeason(next);
  }, [seasonPicked, competitionsFetched, competitions, seasons, season]);

  const { data: analysis, isLoading } = useQuery({
    queryKey: ["competition-club-analysis", selectedCompId],
    queryFn: () => api.stats.competitionClubAnalysis({ competition_id: selectedCompId! }),
    enabled: !!selectedCompId,
  });

  return (
    <div>
      <ClubTabBar />

      {/* Page header */}
      <div className="mb-6">
        <h1 className="font-headline text-2xl font-bold text-on-surface">
          Analyse compétition
        </h1>
        <p className="text-sm text-on-surface-variant mt-0.5">
          Performance du club sur une compétition
        </p>
      </div>

      {/* Filter row */}
      <div className="flex items-center gap-4 mb-6 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-[11px] uppercase tracking-wider text-on-surface-variant">
            Saison
          </span>
          <select
            value={season}
            onChange={(e) => {
              setSelectedSeason(e.target.value);
              setSeasonPicked(true);
              setSelectedCompId(null);
            }}
            className="bg-surface-container rounded-lg px-3 py-1.5 text-sm text-on-surface border-none focus:ring-2 focus:ring-primary"
          >
            {seasons.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        <div
          data-tour="club-competition-selecteur"
          className="flex items-center gap-2 min-w-0 flex-1"
        >
          <span className="text-[11px] uppercase tracking-wider text-on-surface-variant shrink-0">
            Compétition
          </span>
          <select
            value={selectedCompId ?? ""}
            onChange={(e) => setSelectedCompId(e.target.value ? Number(e.target.value) : null)}
            className="bg-surface-container rounded-lg px-3 py-1.5 text-sm text-on-surface border-none focus:ring-2 focus:ring-primary min-w-0 flex-1"
          >
            <option value="">Sélectionner...</option>
            {competitions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}{c.city ? ` — ${c.city}` : ""}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Content */}
      {!selectedCompId && (
        <p className="text-sm text-on-surface-variant">
          Sélectionnez une compétition pour voir l'analyse.
        </p>
      )}

      {isLoading && (
        <div className="flex items-center gap-2 text-sm text-on-surface-variant">
          <span className="material-symbols-outlined animate-spin text-primary">progress_activity</span>
          Chargement...
        </div>
      )}

      {analysis && analysis.results.length === 0 && (
        <p className="text-sm text-on-surface-variant">
          Aucun patineur du club dans cette compétition.
        </p>
      )}

      {analysis && analysis.results.length > 0 && (
        <>
          {/* KPI Hero Row */}
          <div data-tour="club-competition-kpis" className="grid grid-cols-4 gap-3 mb-6">
            {[
              { value: analysis.kpis.skaters_entered, label: "Patineurs engagés" },
              { value: analysis.kpis.total_medals, label: "Médailles" },
              { value: analysis.kpis.personal_bests, label: "Records personnels" },
              {
                value: `${analysis.kpis.categories_entered}/${analysis.kpis.categories_total}`,
                label: "Catégories couvertes",
              },
            ].map((kpi) => (
              <div
                key={kpi.label}
                className="bg-surface-container-lowest rounded-xl shadow-sm p-4 text-center"
              >
                <div className="font-mono text-2xl font-bold text-primary">
                  {kpi.value}
                </div>
                <div className="text-[10px] text-on-surface-variant mt-1">
                  {kpi.label}
                </div>
              </div>
            ))}
          </div>

          {/* Two-column: Club Challenge + Medals */}
          <div className="grid grid-cols-[3fr_2fr] gap-4 mb-6">
            {/* Club Challenge Ranking */}
            <div
              data-tour="club-competition-challenge"
              className="bg-surface-container-lowest rounded-xl shadow-sm p-5"
            >
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-headline font-bold text-on-surface text-sm flex items-center gap-2">
                  <span className="material-symbols-outlined text-lg">emoji_events</span>
                  Classement Club Challenge
                </h2>
                <button
                  onClick={() => setShowCategoryModal(true)}
                  className="text-xs text-primary hover:underline underline-offset-2"
                >
                  Voir le détail par catégorie ›
                </button>
              </div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-on-surface-variant text-left">
                    <th className="py-1 px-2 w-8">#</th>
                    <th className="py-1 px-2">Club</th>
                    <th className="py-1 px-2 text-right">Points</th>
                    <th className="py-1 px-2 text-right text-[10px]">Podium</th>
                  </tr>
                </thead>
                <tbody>
                  {analysis.club_challenge.ranking.map((entry) => (
                    <tr
                      key={entry.club}
                      className={entry.is_my_club
                        ? "bg-primary/10 font-semibold"
                        : "text-on-surface-variant"
                      }
                    >
                      <td className="py-1.5 px-2 font-mono">{entry.rank}</td>
                      <td className={`py-1.5 px-2 ${entry.is_my_club ? "text-primary" : ""}`}>
                        {entry.club}
                      </td>
                      <td className="py-1.5 px-2 text-right font-mono">{entry.total_points}</td>
                      <td className="py-1.5 px-2 text-right font-mono text-on-surface-variant">
                        {entry.podium_points}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Medals */}
            <div
              data-tour="club-competition-podiums"
              className="bg-surface-container-lowest rounded-xl shadow-sm p-5 flex flex-col"
            >
              <h2 className="font-headline font-bold text-on-surface text-sm mb-4">
                Podiums du club
              </h2>
              {analysis.medals.length === 0 ? (
                <p className="text-xs text-on-surface-variant">Aucun podium</p>
              ) : (
                <div className="flex flex-col gap-2 overflow-y-auto max-h-64">
                  {analysis.medals.map((m, i) => {
                    const bg = m.rank === 1 ? "bg-[#fff8e1]" : m.rank === 2 ? "bg-[#f5f5f5]" : "bg-[#fdf0ef]";
                    const icon = m.rank === 1 ? "🥇" : m.rank === 2 ? "🥈" : "🥉";
                    return (
                      <div key={i} className={`flex items-center gap-2 p-2 rounded-lg ${bg}`}>
                        <span className="text-lg">{icon}</span>
                        <div>
                          <div className="font-semibold text-xs text-on-surface">{m.skater_name}</div>
                          <div className="text-[10px] text-on-surface-variant">
                            {m.category} — {m.combined_total?.toFixed(2)} pts
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Detailed Results */}
          <div
            data-tour="club-competition-resultats"
            className="bg-surface-container-lowest rounded-xl shadow-sm p-5"
          >
            <h2 className="font-headline font-bold text-on-surface text-sm mb-4">
              Résultats détaillés
            </h2>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-on-surface-variant text-left">
                  <th className="py-1 px-2">Patineur</th>
                  <th className="py-1 px-2">Catégorie</th>
                  <th className="py-1 px-2 text-center">Rang</th>
                  <th className="py-1 px-2 text-right">Score</th>
                  <th className="py-1 px-2 text-center w-12"></th>
                </tr>
              </thead>
              <tbody>
                {analysis.results.map((r, i) => (
                  <tr
                    key={i}
                    className={r.medal ? "" : "text-on-surface-variant"}
                  >
                    <td className="py-1.5 px-2 font-medium">{r.skater_name}</td>
                    <td className="py-1.5 px-2">{r.category}</td>
                    <td className="py-1.5 px-2 text-center font-mono">
                      {r.overall_rank} / {r.total_skaters}
                    </td>
                    <td className="py-1.5 px-2 text-right font-mono">
                      {r.combined_total?.toFixed(2)}
                    </td>
                    <td className="py-1.5 px-2 text-center">
                      {r.medal === 1 && "🥇"}
                      {r.medal === 2 && "🥈"}
                      {r.medal === 3 && "🥉"}
                      {r.is_pb && " ⭐"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-2 text-[10px] text-on-surface-variant">
              ⭐ = Record personnel
            </div>
          </div>
        </>
      )}

      {/* Category Breakdown Modal */}
      {showCategoryModal && analysis && (
        <CategoryBreakdownModal
          breakdowns={analysis.club_challenge.category_breakdown}
          onClose={() => setShowCategoryModal(false)}
        />
      )}
    </div>
  );
}
