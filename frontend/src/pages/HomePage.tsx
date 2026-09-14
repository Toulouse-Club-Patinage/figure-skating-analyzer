import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api, downloadPdf, Dashboard, DashboardMedal, DashboardMostImproved, DashboardRecentCompetition, DashboardTopScore } from "../api/client";

const SEASONS = ["2025-2026", "2024-2025", "2023-2024", "2022-2023"];

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) {
    return (
      <span className="bg-tertiary-container/40 text-on-tertiary-container text-xs font-bold px-2 py-0.5 rounded-full">
        #1
      </span>
    );
  }
  return (
    <span className="bg-surface-container-high text-on-surface-variant text-xs font-bold px-2 py-0.5 rounded-full">
      #{rank}
    </span>
  );
}

function KpiCard({ label, value, icon }: { label: string; value: number; icon: string }) {
  return (
    <div className="bg-surface-container-lowest rounded-xl shadow-sm border-l-4 border-primary p-6 flex items-start gap-4">
      <div className="bg-primary-container/30 p-2 rounded-lg text-primary">
        <span className="material-symbols-outlined">{icon}</span>
      </div>
      <div>
        <div className="text-3xl font-extrabold font-headline text-on-surface">{value}</div>
        <div className="text-sm font-medium text-on-surface-variant mt-1">{label}</div>
      </div>
    </div>
  );
}

function TopScoresTable({ scores }: { scores: DashboardTopScore[] }) {
  return (
    <div>
      <h2 className="text-base font-bold font-headline text-on-surface mb-4">Meilleurs scores</h2>
      <div className="bg-surface-container-lowest rounded-xl shadow-sm overflow-hidden">
        <table className="w-full">
          <thead className="bg-surface-container-low">
            <tr>
              <th className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant px-4 py-3 text-left">
                Patineur
              </th>
              <th className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant px-4 py-3 text-left">
                Compétition
              </th>
              <th className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant px-4 py-3 text-left">
                Catégorie
              </th>
              <th className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant px-4 py-3 text-right">
                Score total
              </th>
            </tr>
          </thead>
          <tbody>
            {scores.map((score, i) => (
              <tr
                key={i}
                className="hover:bg-surface-container-low/50 transition-colors border-t border-outline-variant/20 first:border-t-0"
              >
                <td className="px-4 py-3 text-sm font-medium">
                  <Link
                    to={`/patineurs/${score.skater_id}/analyse`}
                    className="text-on-surface hover:text-primary transition-colors"
                  >
                    {score.skater_name}
                  </Link>
                </td>
                <td className="px-4 py-3 text-sm text-on-surface-variant">{score.competition_name}</td>
                <td className="px-4 py-3 text-sm text-on-surface-variant">{score.category ?? "—"}</td>
                <td className="px-4 py-3 text-right">
                  <span className="bg-primary-container/30 px-3 py-1 rounded-lg font-mono font-bold text-sm text-on-primary-container">
                    {score.tss.toFixed(2)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MostImprovedCards({ items }: { items: DashboardMostImproved[] }) {
  return (
    <div className="mt-6">
      <h2 className="text-base font-bold font-headline text-on-surface mb-4">Plus grande progression</h2>
      <div className="grid grid-cols-3 gap-4">
        {items.map((item, i) => (
          <Link
            key={i}
            to={`/patineurs/${item.skater_id}/analyse`}
            className="bg-surface-container-lowest rounded-xl p-4 shadow-sm block hover:shadow-md transition-shadow"
          >
            <div className="font-bold font-headline text-on-surface text-sm truncate">{item.skater_name}</div>
            <div className="text-2xl font-extrabold font-mono text-primary mt-2">
              +{item.tss_gain.toFixed(2)}
            </div>
            <div className="text-xs text-on-surface-variant mt-1">
              {item.first_tss.toFixed(2)} → {item.last_tss.toFixed(2)}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

function MedalsPanel({ medals }: { medals: DashboardMedal[] }) {
  const shown = medals.slice(0, 5);
  return (
    <div className="bg-surface-container-lowest rounded-xl shadow-sm p-5">
      <h2 className="text-sm font-bold font-headline text-on-surface mb-3">Podiums récents</h2>
      <ul className="space-y-3">
        {shown.map((medal, i) => (
          <li key={i} className="flex items-start gap-3">
            <RankBadge rank={medal.rank} />
            <div className="min-w-0">
              <div className="text-sm font-medium text-on-surface truncate">{medal.skater_name}</div>
              <div className="text-xs text-on-surface-variant truncate">
                {medal.competition_name}
                {medal.category ? ` · ${medal.category}` : ""}
                {medal.combined_total != null ? ` · ${medal.combined_total.toFixed(2)} pts` : ""}
              </div>
            </div>
          </li>
        ))}
        {shown.length === 0 && (
          <li className="text-sm text-on-surface-variant">Aucun podium pour cette saison.</li>
        )}
      </ul>
    </div>
  );
}

function RecentCompetitionsPanel({ competitions }: { competitions: DashboardRecentCompetition[] }) {
  return (
    <div className="bg-surface-container-lowest rounded-xl shadow-sm p-5 mt-4">
      <h2 className="text-sm font-bold font-headline text-on-surface mb-3">Compétitions récentes</h2>
      <ul>
        {competitions.map((c, i) => (
          <li key={c.id} className={i > 0 ? "border-t border-outline-variant/30" : ""}>
            <Link
              to={`/competitions/${c.id}`}
              className="block py-2 hover:text-primary transition-colors"
            >
              <div className="font-medium text-sm text-on-surface">{c.name}</div>
              <div className="text-xs text-on-surface-variant">
                {[c.date, c.season].filter(Boolean).join(" · ")}
              </div>
            </Link>
          </li>
        ))}
        {competitions.length === 0 && (
          <li className="text-sm text-on-surface-variant">Aucune compétition récente.</li>
        )}
      </ul>
    </div>
  );
}


function LoadingSkeleton() {
  return (
    <div className="animate-pulse space-y-8">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="bg-surface-container-lowest rounded-xl shadow-sm h-24" />
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-surface-container-lowest rounded-xl shadow-sm h-64" />
          <div className="grid grid-cols-3 gap-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="bg-surface-container-lowest rounded-xl shadow-sm h-28" />
            ))}
          </div>
        </div>
        <div className="space-y-4">
          <div className="bg-surface-container-lowest rounded-xl shadow-sm h-48" />
          <div className="bg-surface-container-lowest rounded-xl shadow-sm h-48" />
          <div className="bg-slate-900/20 rounded-xl h-28" />
        </div>
      </div>
    </div>
  );
}

export default function HomePage() {
  const [season, setSeason] = useState("2025-2026");

  const { data: dashboard, isLoading } = useQuery<Dashboard>({
    queryKey: ["dashboard", season],
    queryFn: () => api.dashboard.get(season),
  });

  return (
    <div className="min-h-screen bg-surface-container-low px-6 py-8">
      {/* Header row */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-extrabold font-headline text-on-surface">
            {dashboard?.club_name ?? "Tableau de bord du club"}
          </h1>
          <p className="text-sm text-on-surface-variant mt-0.5">
            Vue d'ensemble de la saison {season}
          </p>
        </div>
        <div data-tour="accueil-saison" className="flex items-center gap-3">
          <select
            value={season}
            onChange={(e) => setSeason(e.target.value)}
            className="bg-transparent border-0 text-sm font-medium text-on-surface-variant focus:ring-0 focus:outline-none cursor-pointer"
          >
            {SEASONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <button
            onClick={() => downloadPdf(`/reports/club/pdf?season=${season}`).catch((e) => alert(`Erreur : ${e.message}`))}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-on-primary rounded-xl text-xs font-bold hover:bg-primary/90 transition-colors cursor-pointer"
          >
            <span className="material-symbols-outlined text-sm">picture_as_pdf</span>
            Rapport de saison
          </button>
        </div>
      </div>

      {isLoading && <LoadingSkeleton />}

      {!isLoading && !dashboard && (
        <div className="text-center py-24 text-on-surface-variant">
          <span className="material-symbols-outlined text-5xl block mb-3">analytics</span>
          <p className="font-headline font-bold text-on-surface">Aucune donnée disponible</p>
          <p className="text-sm mt-1">Importez des compétitions pour commencer.</p>
        </div>
      )}

      {dashboard && (
        <>
          {/* KPI row */}
          <div data-tour="accueil-indicateurs" className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <KpiCard label="Patineurs actifs" value={dashboard.active_skaters} icon="people" />
            <KpiCard label="Compétitions" value={dashboard.competitions_tracked} icon="emoji_events" />
            <KpiCard label="Programmes notés" value={dashboard.total_programs} icon="assignment" />
            <KpiCard label="Podiums" value={dashboard.medals.length} icon="military_tech" />
          </div>

          {/* Main grid */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mt-8">
            {/* Left wide panel */}
            <div data-tour="accueil-scores" className="lg:col-span-2">
              {dashboard.top_scores.length > 0 ? (
                <TopScoresTable scores={dashboard.top_scores} />
              ) : (
                <div className="bg-surface-container-lowest rounded-xl shadow-sm p-8 text-center text-on-surface-variant text-sm">
                  Aucun score enregistré pour cette saison.
                </div>
              )}

              {dashboard.most_improved.length > 0 && (
                <MostImprovedCards items={dashboard.most_improved} />
              )}
            </div>

            {/* Right narrow panel */}
            <div className="lg:col-span-1">
              <MedalsPanel medals={dashboard.medals} />
              <RecentCompetitionsPanel competitions={dashboard.recent_competitions} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
