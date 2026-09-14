import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, Skater } from "../api/client";
import { countryFlag } from "../utils/countryFlags";

export default function SkaterBrowserPage() {
  const [showAll, setShowAll] = useState(false);
  const [search, setSearch] = useState("");

  const { data: config } = useQuery({
    queryKey: ["config"],
    queryFn: api.config.get,
    staleTime: Infinity,
  });

  const clubShort = config?.club_short;

  const { data: skaters = [], isLoading } = useQuery({
    queryKey: ["skaters", showAll ? null : clubShort],
    queryFn: () => api.skaters.list(showAll ? undefined : { club: clubShort }),
    enabled: showAll || !!clubShort,
  });

  const filtered = skaters.filter((s: Skater) =>
    `${s.first_name} ${s.last_name}`.toLowerCase().includes(search.toLowerCase().trim())
  );

  return (
    <div className="p-6 space-y-6">
      {/* Page header */}
      <div>
        <h1 className="font-headline text-2xl font-bold text-on-surface">
          Patineurs
        </h1>
        <p className="font-body text-sm text-on-surface-variant mt-1">
          {showAll
            ? "Tous les patineurs"
            : "Patineurs de votre club"}
        </p>
      </div>

      {/* Controls row */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        {/* Search input */}
        <div className="relative">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-[18px] pointer-events-none">
            search
          </span>
          <input
            type="text"
            placeholder="Rechercher un patineur…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="bg-surface-container-high rounded-full py-2 pl-10 pr-4 text-sm font-body text-on-surface focus:outline-none focus:ring-2 focus:ring-primary w-full sm:w-64"
          />
        </div>

        {/* Toggle button */}
        {clubShort && (
          <button
            onClick={() => setShowAll((v) => !v)}
            className="border border-outline-variant text-on-surface-variant rounded-lg py-2 px-3 text-xs font-bold font-body active:scale-95 transition-all"
          >
            {showAll
              ? "Afficher mon club uniquement"
              : "Afficher tous les clubs"}
          </button>
        )}
      </div>

      {/* Skater table */}
      <div data-tour="patineurs-liste" className="bg-surface-container-lowest rounded-xl shadow-sm overflow-x-auto">
        {isLoading ? (
          <div className="px-6 py-10 text-sm font-body text-on-surface-variant text-center">
            Chargement…
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-10 text-on-surface-variant">
            <span className="material-symbols-outlined text-4xl">
              person_search
            </span>
            <p className="text-sm font-body">Aucun patineur trouvé.</p>
          </div>
        ) : (
          <table className="w-full">
            <thead className="bg-surface-container-low">
              <tr>
                <th className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant px-6 py-3 text-left">
                  Nom
                </th>
                <th className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant px-6 py-3 text-left">
                  Club
                </th>
                <th className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant px-6 py-3 text-left">
                  Nat.
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s: Skater, index: number) => (
                <tr
                  key={s.id}
                  className={`hover:bg-slate-50 transition-colors ${
                    index % 2 === 0
                      ? "bg-surface-container-lowest"
                      : "bg-slate-50/30"
                  }`}
                >
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      {/* Avatar */}
                      <div className="bg-primary-container text-on-primary-container w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold font-body shrink-0">
                        {s.last_name.charAt(0).toUpperCase()}
                      </div>
                      <Link
                        to={`/patineurs/${s.id}/analyse`}
                        className="font-medium font-body text-on-surface hover:text-primary transition-colors"
                      >
                        {s.first_name} {s.last_name}
                      </Link>
                    </div>
                  </td>
                  <td className="px-6 py-4 font-body text-sm text-on-surface-variant">
                    {s.club ?? "—"}
                  </td>
                  <td className="px-6 py-4 font-mono text-sm text-on-surface-variant">
                    {s.nationality ? (
                      <span>{countryFlag(s.nationality) ?? ""} {s.nationality}</span>
                    ) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
