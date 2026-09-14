import { useState, useMemo, useEffect } from "react";
import { Link } from "react-router-dom";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceArea, ReferenceLine,
  BarChart, Bar,
} from "recharts";
import { api, Skater } from "../api/client";
import ClubTabBar from "../components/ClubTabBar";

// ─── Sparkline component ─────────────────────────────────────────────────────
function Sparkline({ data }: { data: { value: number }[] }) {
  if (data.length < 2) return null;
  const values = data.map((d) => d.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const w = 80, h = 24;
  const points = values
    .map((v, i) => `${(i / (values.length - 1)) * w},${h - ((v - min) / range) * h}`)
    .join(" ");
  return (
    <svg width={w} height={h} className="inline-block">
      <polyline points={points} fill="none" stroke="#2e6385" strokeWidth="1.5" />
    </svg>
  );
}

// ─── Sort helper ──────────────────────────────────────────────────────────────
type SortKey = "tss_gain" | "last_tss" | "skater_name" | "competitions_count";

export default function StatsPage() {
  // ── Shared filter state ────────────────────────────────────────────────────
  const [selectedSeason, setSelectedSeason] = useState<string | null>(null);
  const [selectedLevel, setSelectedLevel] = useState<string | null>(null);
  const [selectedAgeGroup, setSelectedAgeGroup] = useState<string | null>(null);
  const [selectedGender, setSelectedGender] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("tss_gain");
  const [sortAsc, setSortAsc] = useState(false);

  const { data: config } = useQuery({
    queryKey: ["config"],
    queryFn: api.config.get,
    staleTime: Infinity,
  });

  const { data: availableSeasons = [] } = useQuery({
    queryKey: ["competition-seasons"],
    queryFn: api.competitions.seasons,
  });

  const season = selectedSeason ?? config?.current_season ?? undefined;

  // ── Progression ranking (unfiltered — filters applied client-side) ────────
  const { data: allRanking = [], isLoading: loadingRanking } = useQuery({
    queryKey: ["progression-ranking", season],
    queryFn: () => api.stats.progressionRanking({ season }),
  });

  // ── Derive filter options from full (unfiltered) data ──────────────────────
  const filterOptions = useMemo(() => {
    const levels = new Set<string>();
    const ages = new Set<string>();
    const genders = new Set<string>();
    for (const r of allRanking) {
      if (r.skating_level) levels.add(r.skating_level);
      if (r.age_group) ages.add(r.age_group);
      if (r.gender) genders.add(r.gender);
    }
    return {
      levels: [...levels].sort(),
      ageGroups: [...ages].sort(),
      genders: [...genders].sort(),
    };
  }, [allRanking]);

  // ── Apply filters client-side ──────────────────────────────────────────────
  const ranking = useMemo(() => {
    return allRanking.filter((r) => {
      if (selectedLevel && r.skating_level !== selectedLevel) return false;
      if (selectedAgeGroup && r.age_group !== selectedAgeGroup) return false;
      if (selectedGender && r.gender !== selectedGender) return false;
      return true;
    });
  }, [allRanking, selectedLevel, selectedAgeGroup, selectedGender]);

  // ── Sorted ranking (deduplicated per skater — keep best-ranked entry) ─────
  const sortedRanking = useMemo(() => {
    const sorted = [...ranking].sort((a, b) => {
      let cmp = 0;
      if (sortKey === "skater_name") cmp = a.skater_name.localeCompare(b.skater_name);
      else cmp = (a[sortKey] ?? 0) - (b[sortKey] ?? 0);
      if (cmp === 0) cmp = (b.last_tss ?? 0) - (a.last_tss ?? 0); // tie-break
      return sortAsc ? cmp : -cmp;
    });
    const seen = new Set<number>();
    return sorted.filter((entry) => {
      if (seen.has(entry.skater_id)) return false;
      seen.add(entry.skater_id);
      return true;
    });
  }, [ranking, sortKey, sortAsc]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(false); }
  }

  const sortIcon = (key: SortKey) =>
    sortKey === key ? (sortAsc ? "arrow_upward" : "arrow_downward") : "";

  // ── Comparison section state ───────────────────────────────────────────────
  const [selectedSkaterIds, setSelectedSkaterIds] = useState<number[]>([]);
  const [levelOverride, setLevelOverride] = useState<string | null>(null);
  const [ageGroupOverride, setAgeGroupOverride] = useState<string | null>(null);
  const [genderOverride, setGenderOverride] = useState<string | null>(null);

  const { data: skaters = [] } = useQuery({
    queryKey: ["skaters", config?.club_short],
    queryFn: () => api.skaters.list(config?.club_short ? { club: config.club_short } : undefined),
    enabled: !!config?.club_short,
  });

  // Skater IDs present in the season (from allRanking, regardless of level/age/gender filters)
  const seasonSkaterIds = useMemo(() => {
    return new Set(allRanking.map((r) => r.skater_id));
  }, [allRanking]);

  // Further restrict to current level/age/gender filters via filtered ranking
  const filteredSkaterIds = useMemo(() => {
    return new Set(ranking.map((r) => r.skater_id));
  }, [ranking]);

  const filteredSkaters = useMemo(() => {
    const activeFilters = selectedLevel || selectedAgeGroup || selectedGender;
    return skaters.filter((s: Skater) =>
      activeFilters ? filteredSkaterIds.has(s.id) : seasonSkaterIds.has(s.id)
    );
  }, [skaters, seasonSkaterIds, filteredSkaterIds, selectedLevel, selectedAgeGroup, selectedGender]);

  const SKATER_COLORS = ["#2e6385", "#7cb9e8", "#e8a87c"];

  // Fetch category results for each selected skater (max 3, fixed-length hook calls)
  const skater0Query = useQuery({
    queryKey: ["skater-category-results", selectedSkaterIds[0], season],
    queryFn: () => api.skaters.categoryResults(selectedSkaterIds[0]!, season),
    enabled: selectedSkaterIds.length > 0,
  });
  const skater1Query = useQuery({
    queryKey: ["skater-category-results", selectedSkaterIds[1], season],
    queryFn: () => api.skaters.categoryResults(selectedSkaterIds[1]!, season),
    enabled: selectedSkaterIds.length > 1,
  });
  const skater2Query = useQuery({
    queryKey: ["skater-category-results", selectedSkaterIds[2], season],
    queryFn: () => api.skaters.categoryResults(selectedSkaterIds[2]!, season),
    enabled: selectedSkaterIds.length > 2,
  });

  const skaterResults = useMemo(() =>
    selectedSkaterIds.map((id, i) => ({
      id,
      color: SKATER_COLORS[i],
      results: [skater0Query, skater1Query, skater2Query][i]?.data ?? [],
    })),
    [selectedSkaterIds, skater0Query.data, skater1Query.data, skater2Query.data]
  );

  // Determine benchmark params from overrides or first selected skater's results
  const firstSkaterResult = skaterResults[0]?.results[0];
  const benchmarkLevel = levelOverride ?? firstSkaterResult?.skating_level ?? null;
  const benchmarkAgeGroup = ageGroupOverride ?? firstSkaterResult?.age_group ?? null;
  const benchmarkGender = genderOverride ?? firstSkaterResult?.gender ?? null;

  const { data: benchmark } = useQuery({
    queryKey: ["benchmarks", benchmarkLevel, benchmarkAgeGroup, benchmarkGender, season],
    queryFn: () =>
      api.stats.benchmarks({
        skating_level: benchmarkLevel!,
        age_group: benchmarkAgeGroup!,
        gender: benchmarkGender!,
        season,
      }),
    enabled: !!benchmarkLevel && !!benchmarkAgeGroup && !!benchmarkGender,
  });

  // Compute Y-axis domain that includes both skater data and benchmark range
  const comparisonYDomain = useMemo((): [number, number] | [string, string] => {
    const allValues: number[] = [];
    for (const { results } of skaterResults) {
      for (const r of results) {
        if (r.combined_total != null) allValues.push(r.combined_total);
      }
    }
    if (benchmark && benchmark.data_points >= 3 && benchmark.min != null && benchmark.max != null) {
      allValues.push(benchmark.min, benchmark.max);
    }
    if (allValues.length === 0) return ["auto", "auto"];
    const min = Math.min(...allValues);
    const max = Math.max(...allValues);
    const padding = (max - min) * 0.05 || 1;
    return [Math.floor(min - padding), Math.ceil(max + padding)];
  }, [skaterResults, benchmark]);

  // Build chart data: merge all skaters' results onto a common date axis
  const comparisonData = useMemo(() => {
    const dateMap = new Map<string, Record<string, number | null>>();
    for (const { id, results } of skaterResults) {
      for (const r of results) {
        if (!r.competition_date || r.combined_total == null) continue;
        const date = r.competition_date.slice(0, 10);
        if (!dateMap.has(date)) dateMap.set(date, {});
        dateMap.get(date)![`skater_${id}`] = r.combined_total;
      }
    }
    return [...dateMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, values]) => ({ date, ...values }));
  }, [skaterResults]);

  // Clear selected skaters that are no longer in the available list when filters/season change
  useEffect(() => {
    const allowed = (selectedLevel || selectedAgeGroup || selectedGender)
      ? filteredSkaterIds
      : seasonSkaterIds;
    setSelectedSkaterIds((prev) => {
      const next = prev.filter((id) => allowed.has(id));
      return next.length === prev.length ? prev : next;
    });
  }, [filteredSkaterIds, seasonSkaterIds, selectedLevel, selectedAgeGroup, selectedGender]);

  function toggleSkater(id: number) {
    setSelectedSkaterIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 3) return prev;
      return [...prev, id];
    });
  }

  // ── Element mastery ────────────────────────────────────────────────────────
  const { data: mastery, isLoading: loadingMastery } = useQuery({
    queryKey: ["element-mastery", season, selectedLevel, selectedAgeGroup, selectedGender],
    queryFn: () =>
      api.stats.elementMastery({
        season,
        skating_level: selectedLevel ?? undefined,
        age_group: selectedAgeGroup ?? undefined,
        gender: selectedGender ?? undefined,
      }),
    placeholderData: keepPreviousData,
  });

  const hasElements = mastery && (mastery.jumps.length > 0 || mastery.spins.length > 0 || mastery.steps.length > 0);

  return (
    <div className="p-6 space-y-6 font-body">
      <ClubTabBar />
      {/* Page header */}
      <div>
        <h1 className="font-headline text-2xl font-bold text-on-surface">Vue club</h1>
        <p className="text-sm text-on-surface-variant mt-1">
          Analyse collective des patineurs du club
        </p>
      </div>

      {/* Shared filters */}
      <div className="flex flex-wrap gap-3">
        <select
          className="bg-surface-container-high rounded-lg px-3 py-2 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary"
          value={selectedSeason ?? ""}
          onChange={(e) => setSelectedSeason(e.target.value || null)}
        >
          <option value="">{config?.current_season ? `${config.current_season} (en cours)` : "Saison en cours"}</option>
          {availableSeasons
            .filter((s) => s !== config?.current_season)
            .map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
        </select>
        <select
          className="bg-surface-container-high rounded-lg px-3 py-2 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary"
          value={selectedLevel ?? ""}
          onChange={(e) => setSelectedLevel(e.target.value || null)}
        >
          <option value="">Tous les niveaux</option>
          {filterOptions.levels.map((l) => (
            <option key={l} value={l}>{l}</option>
          ))}
        </select>
        <select
          className="bg-surface-container-high rounded-lg px-3 py-2 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary"
          value={selectedAgeGroup ?? ""}
          onChange={(e) => setSelectedAgeGroup(e.target.value || null)}
        >
          <option value="">Toutes les catégories</option>
          {filterOptions.ageGroups.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
        <select
          className="bg-surface-container-high rounded-lg px-3 py-2 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary"
          value={selectedGender ?? ""}
          onChange={(e) => setSelectedGender(e.target.value || null)}
        >
          <option value="">Tous</option>
          {filterOptions.genders.map((g) => (
            <option key={g} value={g}>{g}</option>
          ))}
        </select>
      </div>

      {/* ── PROGRESSION SECTION ── */}
      <div data-tour="club-contenu" className="bg-surface-container-lowest rounded-xl shadow-sm p-6">
        <h2 className="text-base font-extrabold font-headline text-on-surface mb-4">
          Progression
        </h2>
        {loadingRanking ? (
          <div className="animate-pulse bg-surface-container-low rounded-xl h-40" />
        ) : sortedRanking.length === 0 ? (
          <p className="text-on-surface-variant text-sm">
            {selectedLevel || selectedAgeGroup || selectedGender
              ? "Aucun résultat pour les filtres sélectionnés."
              : "Aucun patineur n'a participé à une compétition cette saison."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] border-collapse">
              <thead>
                <tr className="bg-surface-container-low">
                  {[
                    { key: "skater_name" as SortKey, label: "Patineur", left: true },
                    { key: null, label: "Niveau / Catégorie", left: false },
                    { key: null, label: "Premier", left: false },
                    { key: null, label: "Dernier", left: false },
                    { key: "tss_gain" as SortKey, label: "\u0394", left: false },
                    { key: null, label: "Tendance", left: false },
                    { key: "competitions_count" as SortKey, label: "Comp.", left: false },
                  ].map((col, i) => (
                    <th
                      key={col.label}
                      className={`text-[10px] font-black uppercase tracking-widest text-on-surface-variant px-3 py-2.5 ${
                        col.left ? "text-left" : "text-right"
                      } ${i === 0 ? "rounded-tl-xl" : ""} ${i === 6 ? "rounded-tr-xl" : ""} ${
                        col.key ? "cursor-pointer select-none hover:text-on-surface" : ""
                      }`}
                      onClick={col.key ? () => toggleSort(col.key!) : undefined}
                    >
                      {col.label}
                      {col.key && sortIcon(col.key) && (
                        <span className="material-symbols-outlined text-[12px] ml-0.5 align-middle">
                          {sortIcon(col.key)}
                        </span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedRanking.map((entry, idx) => (
                  <tr
                    key={`${entry.skater_id}-${entry.skating_level}`}
                    className={idx % 2 === 0 ? "bg-surface-container-lowest" : "bg-surface-container-low/30"}
                  >
                    <td className="px-3 py-2 text-sm">
                      <Link
                        to={`/patineurs/${entry.skater_id}/analyse`}
                        className="text-primary hover:underline font-medium"
                      >
                        {entry.skater_name}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <span className="inline-block bg-primary-container/30 text-on-surface-variant text-[10px] font-bold px-2 py-0.5 rounded-full">
                        {[entry.skating_level, entry.age_group].filter(Boolean).join(" \u00b7 ")}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-sm text-on-surface-variant">
                      {entry.first_tss.toFixed(2)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-sm text-on-surface">
                      {entry.last_tss.toFixed(2)}
                    </td>
                    <td className={`px-3 py-2 text-right font-mono text-sm font-bold ${
                      entry.tss_gain > 0 ? "text-green-700" : entry.tss_gain < 0 ? "text-error" : "text-on-surface-variant"
                    }`}>
                      {entry.tss_gain > 0 ? "+" : ""}{entry.tss_gain.toFixed(2)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Sparkline data={entry.sparkline} />
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-sm text-on-surface-variant">
                      {entry.competitions_count}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── COMPARISON SECTION ── */}
      <div className="bg-surface-container-lowest rounded-xl shadow-sm p-6">
        <h2 className="text-base font-extrabold font-headline text-on-surface mb-4">
          Comparaison
        </h2>

        {/* Skater selector: dropdown + selected chips */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          {selectedSkaterIds.map((id, idx) => {
            const skater = skaters.find((s: Skater) => s.id === id);
            if (!skater) return null;
            return (
              <span
                key={id}
                className="inline-flex items-center gap-1 pl-2.5 pr-1 py-1 rounded-full text-xs font-bold text-white"
                style={{ backgroundColor: SKATER_COLORS[idx] }}
              >
                {skater.first_name} {skater.last_name}
                <button
                  onClick={() => toggleSkater(id)}
                  className="rounded-full hover:bg-white/20 p-0.5 transition-colors"
                >
                  <span className="material-symbols-outlined text-[14px]">close</span>
                </button>
              </span>
            );
          })}
          {selectedSkaterIds.length < 3 && (
            <select
              className="bg-surface-container-high rounded-lg px-3 py-1.5 text-xs text-on-surface-variant focus:outline-none focus:ring-2 focus:ring-primary"
              value=""
              onChange={(e) => {
                if (e.target.value) toggleSkater(Number(e.target.value));
              }}
            >
              <option value="">
                {filteredSkaters.length === 0
                  ? "Aucun patineur"
                  : `+ Ajouter un patineur (${filteredSkaters.length - selectedSkaterIds.length})`}
              </option>
              {filteredSkaters
                .filter((s: Skater) => !selectedSkaterIds.includes(s.id))
                .sort((a: Skater, b: Skater) => a.last_name.localeCompare(b.last_name))
                .map((s: Skater) => (
                  <option key={s.id} value={s.id}>
                    {s.last_name} {s.first_name}
                  </option>
                ))}
            </select>
          )}
        </div>

        {/* Benchmark overrides */}
        {selectedSkaterIds.length > 0 && (
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <span className="text-xs text-on-surface-variant">Benchmark :</span>
            <select
              className="bg-surface-container-high rounded-lg px-3 py-1.5 text-xs text-on-surface focus:outline-none focus:ring-2 focus:ring-primary"
              value={levelOverride ?? ""}
              onChange={(e) => setLevelOverride(e.target.value || null)}
            >
              <option value="">
                {firstSkaterResult?.skating_level ?? "Niveau"}
              </option>
              {filterOptions.levels.map((l) => (
                <option key={l} value={l}>{l}</option>
              ))}
            </select>
            <select
              className="bg-surface-container-high rounded-lg px-3 py-1.5 text-xs text-on-surface focus:outline-none focus:ring-2 focus:ring-primary"
              value={ageGroupOverride ?? ""}
              onChange={(e) => setAgeGroupOverride(e.target.value || null)}
            >
              <option value="">
                {firstSkaterResult?.age_group ?? "Catégorie"}
              </option>
              {filterOptions.ageGroups.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
            <select
              className="bg-surface-container-high rounded-lg px-3 py-1.5 text-xs text-on-surface focus:outline-none focus:ring-2 focus:ring-primary"
              value={genderOverride ?? ""}
              onChange={(e) => setGenderOverride(e.target.value || null)}
            >
              <option value="">
                {firstSkaterResult?.gender ?? "Genre"}
              </option>
              {filterOptions.genders.map((g) => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
            {benchmark && benchmark.data_points > 0 && benchmark.data_points < 3 && (
              <span className="text-xs text-on-surface-variant italic">
                Données insuffisantes pour le benchmark
              </span>
            )}
          </div>
        )}

        {selectedSkaterIds.length === 0 ? (
          <div className="flex items-center justify-center h-[260px] text-on-surface-variant text-sm">
            Sélectionnez des patineurs pour comparer leur progression.
          </div>
        ) : (
          <>
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={comparisonData} margin={{ top: 4, right: 8, left: -16, bottom: 4 }}>
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
                domain={comparisonYDomain}
              />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  return (
                    <div className="bg-white rounded-xl shadow-md px-3 py-2 text-xs" style={{ fontFamily: "Inter, sans-serif" }}>
                      <p className="font-bold text-on-surface mb-1">{label}</p>
                      {payload.map((entry: any) => (
                        <p key={entry.dataKey} style={{ color: entry.color }}>
                          {entry.name} : <span className="font-mono">{entry.value?.toFixed(2)}</span>
                        </p>
                      ))}
                      {benchmark && benchmark.data_points >= 3 && (
                        <div className="mt-1.5 pt-1.5 border-t border-outline-variant/30 text-on-surface-variant">
                          <p>Benchmark ({benchmark.data_points} résultats)</p>
                          <p className="font-mono">Médiane : {benchmark.median?.toFixed(2)}</p>
                          <p className="font-mono">P25–P75 : {benchmark.p25?.toFixed(2)}–{benchmark.p75?.toFixed(2)}</p>
                          <p className="font-mono">Min–Max : {benchmark.min?.toFixed(2)}–{benchmark.max?.toFixed(2)}</p>
                        </div>
                      )}
                    </div>
                  );
                }}
              />

              {/* Benchmark bands */}
              {benchmark && benchmark.data_points >= 3 && benchmark.min != null && benchmark.max != null && (
                <>
                  <ReferenceArea
                    y1={benchmark.min} y2={benchmark.max}
                    fill="#2e6385" fillOpacity={0.04}
                  />
                  <ReferenceArea
                    y1={benchmark.p25!} y2={benchmark.p75!}
                    fill="#2e6385" fillOpacity={0.1}
                  />
                  <ReferenceLine
                    y={benchmark.median!}
                    stroke="#2e6385" strokeDasharray="4 4" strokeOpacity={0.6}
                  />
                </>
              )}

              {/* Skater lines */}
              {skaterResults.map(({ id, color }) => {
                const skater = skaters.find((s: Skater) => s.id === id);
                return (
                  <Line
                    key={id}
                    type="monotone"
                    dataKey={`skater_${id}`}
                    name={skater ? `${skater.first_name} ${skater.last_name}` : `#${id}`}
                    stroke={color}
                    strokeWidth={2}
                    dot={{ r: 3, fill: color, stroke: "#fff", strokeWidth: 1.5 }}
                    connectNulls={false}
                  />
                );
              })}
            </ComposedChart>
          </ResponsiveContainer>
          {/* Inline legend */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-[10px] text-on-surface-variant">
            {skaterResults.map(({ id, color }) => {
              const skater = skaters.find((s: Skater) => s.id === id);
              return (
                <span key={id} className="flex items-center gap-1">
                  <span className="inline-block w-3 h-0.5 rounded" style={{ backgroundColor: color }} />
                  {skater ? `${skater.first_name} ${skater.last_name}` : `#${id}`}
                </span>
              );
            })}
            {benchmark && benchmark.data_points >= 3 && (
              <>
                <span className="flex items-center gap-1">
                  <span className="inline-block w-3 h-2 rounded-sm" style={{ backgroundColor: "rgba(46,99,133,0.1)" }} />
                  P25–P75
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block w-3 h-2 rounded-sm" style={{ backgroundColor: "rgba(46,99,133,0.04)" }} />
                  Min–Max
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block w-3 h-0 border-t border-dashed" style={{ borderColor: "#2e6385" }} />
                  Médiane
                </span>
              </>
            )}
          </div>
          </>
        )}
      </div>

      {/* ── ELEMENT MASTERY SECTION ── */}
      <div className="bg-surface-container-lowest rounded-xl shadow-sm p-6">
        <h2 className="text-base font-extrabold font-headline text-on-surface mb-4">
          Maîtrise des éléments
        </h2>

        {loadingMastery ? (
          <div className="animate-pulse bg-surface-container-low rounded-xl h-60" />
        ) : !hasElements ? (
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
                  {mastery && mastery.jumps.length === 0 && (selectedLevel || selectedAgeGroup || selectedGender)
                    ? "Aucun élément trouvé pour les filtres sélectionnés."
                    : "Importez les PDFs pour voir l'analyse d'éléments détaillée."}
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Jump success rates */}
            <div>
              <h3 className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant mb-3">
                Taux de réussite des sauts
              </h3>
              <ResponsiveContainer width="100%" height={Math.max(200, mastery!.jumps.length * 32)}>
                <BarChart
                  data={mastery!.jumps}
                  layout="vertical"
                  margin={{ top: 0, right: 40, left: 0, bottom: 0 }}
                >
                  <CartesianGrid horizontal={false} stroke="#e0e3e5" />
                  <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis
                    type="category" dataKey="jump_type" width={40}
                    tick={{ fontSize: 11, fontFamily: "monospace", fill: "#191c1e" }}
                    axisLine={false} tickLine={false}
                  />
                  <Tooltip
                    formatter={(value: number, name: string) => [`${value.toFixed(1)}%`, name]}
                    contentStyle={{ fontSize: 11, borderRadius: 12, border: "none", boxShadow: "0 1px 4px rgba(0,0,0,0.12)" }}
                  />
                  <Bar dataKey="positive_goe_pct" name="GOE +" stackId="goe" fill="#4caf50" />
                  <Bar dataKey="neutral_goe_pct" name="GOE 0" stackId="goe" fill="#ffc107" />
                  <Bar dataKey="negative_goe_pct" name="GOE −" stackId="goe" fill="#f44336" />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Spin/step level distribution */}
            <div>
              <h3 className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant mb-3">
                Niveaux pirouettes et pas
              </h3>
              {(() => {
                const LEVEL_KEYS = [0, 0.5, 1, 2, 3, 4] as const;
                const LEVEL_LABELS: Record<number, string> = { 0: "Sans niveau", 0.5: "Base", 1: "Niveau 1", 2: "Niveau 2", 3: "Niveau 3", 4: "Niveau 4" };
                const LEVEL_COLORS_MAP: Record<number, string> = { 0: "#e0e0e0", 0.5: "#cfd8dc", 1: "#b0bec5", 2: "#78909c", 3: "#455a64", 4: "#263238" };
                const combined = [...(mastery!.spins ?? []), ...(mastery!.steps ?? [])];
                const chartData = combined.map((el) => ({
                  name: el.element_type,
                  ...Object.fromEntries(
                    Object.entries(el.level_distribution).map(([k, v]) => [`level_${k}`, v])
                  ),
                  avg_goe: el.avg_goe,
                  attempts: el.attempts,
                }));
                return (
                  <ResponsiveContainer width="100%" height={Math.max(200, chartData.length * 32)}>
                    <BarChart
                      data={chartData}
                      layout="vertical"
                      margin={{ top: 0, right: 40, left: 0, bottom: 0 }}
                    >
                      <CartesianGrid horizontal={false} stroke="#e0e3e5" />
                      <XAxis type="number" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                      <YAxis
                        type="category" dataKey="name" width={60}
                        tick={{ fontSize: 11, fontFamily: "monospace", fill: "#191c1e" }}
                        axisLine={false} tickLine={false}
                      />
                      <Tooltip
                        contentStyle={{ fontSize: 11, borderRadius: 12, border: "none", boxShadow: "0 1px 4px rgba(0,0,0,0.12)" }}
                      />
                      {LEVEL_KEYS.map((level) => (
                        <Bar
                          key={level}
                          dataKey={`level_${level}`}
                          name={LEVEL_LABELS[level]}
                          stackId="levels"
                          fill={LEVEL_COLORS_MAP[level]}
                        />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                );
              })()}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
