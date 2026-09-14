import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api, Competition, JobInfo, BulkImportResult, COMPETITION_TYPES, LIGUES } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { useJobs } from "../contexts/JobContext";
import ErrorDetailModal from "../components/ErrorDetailModal";

const inputClass =
  "bg-surface-container rounded-lg px-4 py-3 w-full focus:outline-none focus:ring-2 focus:ring-primary text-sm text-on-surface placeholder:text-on-surface-variant";

export default function CompetitionsPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const {
    activeJobs,
    trackJob,
    importResults,
    enrichResults,
    failedErrors,
    dismissedResults,
    dismissedEnrich,
    dismissImportResult,
    dismissEnrichResult,
    dismissFailedError,
  } = useJobs();

  const [errorModalCompId, setErrorModalCompId] = useState<number | null>(null);

  const { data: competitions, isLoading, error } = useQuery({
    queryKey: ["competitions"],
    queryFn: () => api.competitions.list(),
  });

  const [showForm, setShowForm] = useState(false);
  const [importUrl, setImportUrl] = useState("");

  const [filterSeason, setFilterSeason] = useState<string>("all");
  const [filterType, setFilterType] = useState<string>("all");
  const [sortBy, setSortBy] = useState<string>("date-desc");
  const [showUnconfirmedOnly, setShowUnconfirmedOnly] = useState(false);
  const [confirmingReimportId, setConfirmingReimportId] = useState<number | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<number | null>(null);
  const [filterLigue, setFilterLigue] = useState<string>("all");
  const [showPolledOnly, setShowPolledOnly] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [confirmingBulkAction, setConfirmingBulkAction] = useState<"reimport" | "enrich" | "reimport+enrich" | null>(null);

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const bulkActionMutation = useMutation({
    mutationFn: (action: "reimport" | "enrich" | "reimport+enrich") =>
      api.competitions.bulkAction({ competition_ids: Array.from(selectedIds), action }),
    onSuccess: (result: BulkImportResult) => {
      result.job_ids.forEach((jobId) => {
        api.jobs.get(jobId).then((job) => trackJob(job));
      });
      setSelectedIds(new Set());
      setConfirmingBulkAction(null);
    },
  });

  const createMutation = useMutation({
    mutationFn: async (url: string) => {
      const comp = await api.competitions.create({ name: url, url });
      const importJob = await api.competitions.import(comp.id);
      trackJob(importJob);
      const enrichJob = await api.competitions.enrich(comp.id);
      trackJob(enrichJob);
      return comp;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["competitions"] });
      setShowForm(false);
      setImportUrl("");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: api.competitions.delete,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["competitions"] }),
  });

  const importMutation = useMutation({
    mutationFn: (id: number) => api.competitions.import(id),
    onSuccess: (job: JobInfo) => trackJob(job),
  });

  const reimportMutation = useMutation({
    mutationFn: (id: number) => api.competitions.reimport(id),
    onSuccess: (job: JobInfo) => trackJob(job),
  });

  const enrichMutation = useMutation({
    mutationFn: (id: number) => api.competitions.enrich(id),
    onSuccess: (job: JobInfo) => trackJob(job),
  });

  const [openMenuId, setOpenMenuId] = useState<number | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (openMenuId === null) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenuId(null);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [openMenuId]);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<{
    name: string;
    city: string;
    country: string;
    competition_type: string;
    season: string;
    ligue: string;
  }>({ name: "", city: "", country: "", competition_type: "", season: "", ligue: "" });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Record<string, string> }) =>
      api.competitions.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["competitions"] });
      setEditingId(null);
    },
  });

  const confirmMutation = useMutation({
    mutationFn: (id: number) => api.competitions.confirmMetadata(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["competitions"] }),
  });

  const pollingMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) =>
      api.competitions.togglePolling(id, enabled),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["competitions"] }),
  });

  // Maps competition_id → list of active job IDs
  const competitionJobs: Record<number, string[]> = {};
  for (const [jobId, job] of Object.entries(activeJobs)) {
    if (job.status === "queued" || job.status === "running") {
      if (!competitionJobs[job.competition_id]) {
        competitionJobs[job.competition_id] = [];
      }
      competitionJobs[job.competition_id].push(jobId);
    }
  }

  const seasons = Array.from(
    new Set(competitions?.map((c) => c.season).filter(Boolean) as string[])
  ).sort().reverse();

  function getCompetitionStatus(c: Competition): { label: string; className: string } | null {
    if (!c.date) return null;
    const today = new Date().toISOString().split("T")[0];
    const endDate = c.date_end ?? c.date;
    if (c.date > today) {
      return { label: "Prochainement", className: "bg-primary/10 text-primary" };
    }
    if (c.date <= today && endDate >= today) {
      return { label: "En cours", className: "bg-error/10 text-error" };
    }
    return null;
  }

  const filteredCompetitions = (competitions ?? [])
    .filter((c) => filterSeason === "all" || c.season === filterSeason)
    .filter((c) => filterType === "all" || c.competition_type === filterType)
    .filter((c) => filterLigue === "all" || c.ligue === filterLigue)
    .filter((c) => !showUnconfirmedOnly || !c.metadata_confirmed)
    .filter((c) => !showPolledOnly || c.polling_enabled)
    .sort((a, b) => {
      switch (sortBy) {
        case "date-asc":
          return (a.date ?? "").localeCompare(b.date ?? "");
        case "date-desc":
          return (b.date ?? "").localeCompare(a.date ?? "");
        case "city-asc":
          return (a.city ?? "").localeCompare(b.city ?? "");
        case "city-desc":
          return (b.city ?? "").localeCompare(a.city ?? "");
        case "country-asc":
          return (a.country ?? "").localeCompare(b.country ?? "");
        default:
          return (b.date ?? "").localeCompare(a.date ?? "");
      }
    });

  return (
    <div>
      {/* Page header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-headline text-2xl font-bold text-on-surface">
            Compétitions
          </h1>
          <p className="text-sm text-on-surface-variant mt-0.5">
            Gérez vos compétitions et importez les résultats
          </p>
        </div>
        {isAdmin && (
          <button
            data-tour="competitions-import"
            onClick={() => setShowForm((v) => !v)}
            className="bg-primary text-on-primary rounded-lg py-2 px-4 text-xs font-bold active:scale-95 transition-all"
          >
            + Ajouter
          </button>
        )}
      </div>

      {/* Add competition form */}
      {showForm && (
        <form
          className="bg-surface-container-lowest rounded-xl shadow-sm p-6 mb-6"
          onSubmit={(e) => {
            e.preventDefault();
            createMutation.mutate(importUrl);
          }}
        >
          <h2 className="font-headline font-bold text-on-surface text-base mb-4">
            Importer une compétition
          </h2>
          <input
            className={inputClass}
            placeholder="URL du site de résultats"
            required
            type="url"
            value={importUrl}
            onChange={(e) => setImportUrl(e.target.value)}
          />
          <p className="text-xs text-on-surface-variant mt-1.5">
            Le nom, la saison, la ville et le type seront détectés automatiquement.
          </p>
          <div className="flex gap-2 mt-4">
            <button
              type="submit"
              disabled={createMutation.isPending}
              className="bg-primary text-on-primary rounded-lg py-2 px-4 text-xs font-bold active:scale-95 transition-all disabled:opacity-50 flex items-center gap-1.5"
            >
              <span className="material-symbols-outlined text-sm">download</span>
              {createMutation.isPending ? "Importation..." : "Importer"}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="border border-outline-variant text-on-surface-variant rounded-lg py-2 px-4 text-xs font-bold"
            >
              Annuler
            </button>
          </div>
          {createMutation.isError && (
            <p className="text-error text-sm mt-3">
              {String(createMutation.error)}
            </p>
          )}
        </form>
      )}

      {/* Filter bar */}
      {competitions && competitions.length > 0 && (
        <div className="bg-surface-container-lowest rounded-xl shadow-sm p-4 mb-4 space-y-3">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-[11px] uppercase tracking-wider text-on-surface-variant">Saison</span>
              <select
                value={filterSeason}
                onChange={(e) => setFilterSeason(e.target.value)}
                className="bg-surface-container rounded-lg px-3 py-1.5 text-sm text-on-surface border-none focus:ring-2 focus:ring-primary"
              >
                <option value="all">Toutes</option>
                {seasons.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] uppercase tracking-wider text-on-surface-variant">Type</span>
              <select
                value={filterType}
                onChange={(e) => setFilterType(e.target.value)}
                className="bg-surface-container rounded-lg px-3 py-1.5 text-sm text-on-surface border-none focus:ring-2 focus:ring-primary"
              >
                <option value="all">Tous</option>
                {Object.entries(COMPETITION_TYPES).map(([code, label]) => (
                  <option key={code} value={code}>{label}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] uppercase tracking-wider text-on-surface-variant">Ligue</span>
              <select
                value={filterLigue}
                onChange={(e) => setFilterLigue(e.target.value)}
                className="bg-surface-container rounded-lg px-3 py-1.5 text-sm text-on-surface border-none focus:ring-2 focus:ring-primary"
              >
                <option value="all">Toutes</option>
                {Object.entries(LIGUES).map(([code, label]) => (
                  <option key={code} value={code}>{label}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] uppercase tracking-wider text-on-surface-variant">Trier par</span>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="bg-surface-container rounded-lg px-3 py-1.5 text-sm text-on-surface border-none focus:ring-2 focus:ring-primary"
              >
                <option value="date-desc">Date ↓</option>
                <option value="date-asc">Date ↑</option>
                <option value="city-asc">Ville A→Z</option>
                <option value="city-desc">Ville Z→A</option>
                <option value="country-asc">Pays A→Z</option>
              </select>
            </div>
          </div>
          <div className="flex items-center gap-4 justify-end">
            <label className="flex items-center gap-1.5 text-xs text-on-surface-variant cursor-pointer">
              <input
                type="checkbox"
                checked={showUnconfirmedOnly}
                onChange={(e) => setShowUnconfirmedOnly(e.target.checked)}
                className="accent-error"
              />
              À vérifier uniquement
            </label>
            <label className="flex items-center gap-1.5 text-xs text-on-surface-variant cursor-pointer">
              <input
                type="checkbox"
                checked={showPolledOnly}
                onChange={(e) => setShowPolledOnly(e.target.checked)}
                className="accent-primary"
              />
              Suivi auto
            </label>
          </div>
        </div>
      )}

      {/* Select all (admin only, separate from filters) */}
      {isAdmin && competitions && competitions.length > 0 && (
        <div className="flex items-center gap-3 mb-4 px-1">
          <label className="flex items-center gap-1.5 text-xs text-on-surface-variant cursor-pointer">
            <input
              type="checkbox"
              checked={filteredCompetitions.length > 0 && filteredCompetitions.every((c) => selectedIds.has(c.id))}
              ref={(el) => {
                if (el) {
                  const allSelected = filteredCompetitions.length > 0 && filteredCompetitions.every((c) => selectedIds.has(c.id));
                  const someSelected = filteredCompetitions.some((c) => selectedIds.has(c.id));
                  el.indeterminate = someSelected && !allSelected;
                }
              }}
              onChange={(e) => {
                if (e.target.checked) {
                  setSelectedIds(new Set(filteredCompetitions.map((c) => c.id)));
                } else {
                  setSelectedIds(new Set());
                }
              }}
              className="accent-primary"
            />
            Tout sélectionner
          </label>
          {selectedIds.size > 0 && (
            <span className="text-xs text-on-surface-variant">
              ({selectedIds.size} sélectionnée{selectedIds.size > 1 ? "s" : ""})
            </span>
          )}
        </div>
      )}

      {/* Bulk action bar */}
      {isAdmin && selectedIds.size > 0 && (
        <div className="bg-primary/5 rounded-xl p-4 mb-4 flex items-center gap-3 flex-wrap">
          <span className="text-sm font-medium text-on-surface">
            {selectedIds.size} compétition{selectedIds.size > 1 ? "s" : ""} sélectionnée{selectedIds.size > 1 ? "s" : ""}
          </span>
          <button
            onClick={() => setSelectedIds(new Set())}
            className="text-xs text-on-surface-variant hover:text-on-surface transition-colors"
          >
            Tout désélectionner
          </button>
          <div className="flex gap-2 sm:ml-auto">
            {confirmingBulkAction ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-on-surface-variant">
                  {confirmingBulkAction === "reimport" && "Réimporter"}
                  {confirmingBulkAction === "enrich" && "Enrichir"}
                  {confirmingBulkAction === "reimport+enrich" && "Réimporter + Enrichir"}
                  {" "}{selectedIds.size} compétition{selectedIds.size > 1 ? "s" : ""} ?
                </span>
                <button
                  onClick={() => bulkActionMutation.mutate(confirmingBulkAction)}
                  disabled={bulkActionMutation.isPending}
                  className="bg-primary text-on-primary rounded-lg py-1.5 px-3 text-xs font-bold active:scale-95 transition-all disabled:opacity-50"
                >
                  {bulkActionMutation.isPending ? "En cours..." : "Confirmer"}
                </button>
                <button
                  onClick={() => setConfirmingBulkAction(null)}
                  className="bg-surface-container text-on-surface-variant rounded-lg py-1.5 px-3 text-xs font-bold"
                >
                  Annuler
                </button>
              </div>
            ) : (
              <>
                <button
                  onClick={() => setConfirmingBulkAction("reimport")}
                  className="bg-surface-container text-on-surface-variant rounded-lg py-1.5 px-3 text-xs font-bold active:scale-95 transition-all flex items-center gap-1"
                >
                  <span className="material-symbols-outlined text-base leading-none">refresh</span>
                  Réimporter
                </button>
                <button
                  onClick={() => setConfirmingBulkAction("enrich")}
                  className="bg-surface-container text-on-surface-variant rounded-lg py-1.5 px-3 text-xs font-bold active:scale-95 transition-all flex items-center gap-1"
                >
                  <span className="material-symbols-outlined text-base leading-none">description</span>
                  Enrichir PDF
                </button>
                <button
                  onClick={() => setConfirmingBulkAction("reimport+enrich")}
                  className="bg-primary text-on-primary rounded-lg py-1.5 px-3 text-xs font-bold active:scale-95 transition-all flex items-center gap-1"
                >
                  <span className="material-symbols-outlined text-base leading-none">sync</span>
                  Réimporter + Enrichir
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Loading / error states */}
      {isLoading && (
        <p className="text-sm text-on-surface-variant">Chargement...</p>
      )}
      {error && (
        <p className="text-sm text-error">{String(error)}</p>
      )}

      {/* Empty state */}
      {competitions && competitions.length === 0 && (
        <p className="text-sm text-on-surface-variant">
          Aucune compétition. Ajoutez-en une pour commencer.
        </p>
      )}

      {/* Competition list */}
      <div data-tour="competitions-liste" className="space-y-3">
        {filteredCompetitions.map((c: Competition) => {
          const compJobs = competitionJobs[c.id] || [];
          const activeJobTypes = compJobs.map((jid) => activeJobs[jid]?.type);
          const isImporting = activeJobTypes.includes("import") || activeJobTypes.includes("reimport");
          const isEnriching = activeJobTypes.includes("enrich");

          const importJobStatus = compJobs
            .map((jid) => activeJobs[jid])
            .find((j) => j?.type === "import" || j?.type === "reimport")?.status;
          const enrichJobStatus = compJobs
            .map((jid) => activeJobs[jid])
            .find((j) => j?.type === "enrich")?.status;

          const result = importResults[c.id];
          const isDismissed = dismissedResults.has(c.id);
          const enrichResult = enrichResults[c.id];
          const isEnrichDismissed = dismissedEnrich.has(c.id);
          const failedError = failedErrors[c.id];

          return (
            <div key={c.id}>
              <div className="bg-surface-container-lowest rounded-xl shadow-sm p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                {/* Left: name + meta */}
                <div className="min-w-0 flex items-start gap-3">
                  {isAdmin && (
                    <input
                      type="checkbox"
                      checked={selectedIds.has(c.id)}
                      onChange={() => toggleSelect(c.id)}
                      className="accent-primary mt-1 shrink-0"
                    />
                  )}
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <Link
                      to={`/competitions/${c.id}`}
                      className="font-bold font-headline text-on-surface hover:text-primary transition-colors"
                    >
                      {c.name}
                    </Link>
                    <a
                      href={c.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-on-surface-variant hover:text-primary transition-colors"
                      title="Ouvrir les résultats"
                    >
                      <span className="material-symbols-outlined text-[16px] leading-none">open_in_new</span>
                    </a>
                    {c.competition_type && (
                      <span className="bg-surface-container text-on-surface-variant text-[10px] font-semibold px-2 py-0.5 rounded-full">
                        {COMPETITION_TYPES[c.competition_type] ?? c.competition_type}
                      </span>
                    )}
                    {!c.metadata_confirmed && (
                      <span className="bg-error-container/50 text-on-error-container text-[10px] font-semibold px-2 py-0.5 rounded-full">
                        À vérifier
                      </span>
                    )}
                    {(() => {
                      const status = getCompetitionStatus(c);
                      return status ? (
                        <span className={`${status.className} text-[10px] font-semibold px-2 py-0.5 rounded-full`}>
                          {status.label}
                        </span>
                      ) : null;
                    })()}
                  </div>
                  <p className="text-xs text-on-surface-variant mt-1">
                    {[
                      c.city && c.country ? `${c.city}, ${c.country}` : c.city || c.country,
                      c.date ? new Date(c.date).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" }) : null,
                      c.season,
                      c.ligue,
                    ].filter(Boolean).join(" · ")}
                  </p>
                </div>
                </div>

                {/* Right: action buttons (admin only) */}
                {isAdmin && (
                  <>
                    {/* Desktop: inline buttons */}
                    <div className="hidden lg:flex flex-wrap gap-2 shrink-0">
                      <button
                        onClick={() => pollingMutation.mutate({ id: c.id, enabled: !c.polling_enabled })}
                        disabled={pollingMutation.isPending}
                        className={`rounded-lg py-1.5 px-2 text-xs font-bold active:scale-95 transition-all flex items-center gap-1 ${
                          c.polling_enabled
                            ? "bg-primary text-on-primary"
                            : "bg-surface-container text-on-surface-variant"
                        }`}
                        title={c.polling_enabled ? "Suivi automatique actif" : "Activer le suivi automatique"}
                      >
                        <span className="material-symbols-outlined text-base leading-none">sync</span>
                      </button>
                      {!c.metadata_confirmed && (
                        <button
                          onClick={() => confirmMutation.mutate(c.id)}
                          className="bg-primary text-on-primary rounded-lg py-1.5 px-3 text-xs font-bold active:scale-95 transition-all flex items-center gap-1"
                        >
                          <span className="material-symbols-outlined text-base leading-none">check</span>
                          Valider
                        </button>
                      )}
                      <button
                        onClick={() => {
                          setEditingId(editingId === c.id ? null : c.id);
                          setEditForm({
                            name: c.name ?? "",
                            city: c.city ?? "",
                            country: c.country ?? "",
                            competition_type: c.competition_type ?? "",
                            season: c.season ?? "",
                            ligue: c.ligue ?? "",
                          });
                        }}
                        className="bg-surface-container text-on-surface-variant rounded-lg py-1.5 px-3 text-xs font-bold active:scale-95 transition-all flex items-center gap-1"
                      >
                        <span className="material-symbols-outlined text-base leading-none">edit</span>
                        Modifier
                      </button>
                      <button
                        onClick={() => importMutation.mutate(c.id)}
                        disabled={isImporting}
                        className="bg-primary text-on-primary rounded-lg py-1.5 px-3 text-xs font-bold active:scale-95 transition-all disabled:opacity-50 flex items-center gap-1"
                      >
                        <span className="material-symbols-outlined text-base leading-none">
                          download
                        </span>
                        {importJobStatus === "queued"
                          ? "En file d'attente"
                          : importJobStatus === "running"
                            ? "Importation..."
                            : "Importer"}
                      </button>
                      {confirmingReimportId === c.id ? (
                        <span className="flex items-center gap-1">
                          <button
                            onClick={() => {
                              reimportMutation.mutate(c.id);
                              setConfirmingReimportId(null);
                            }}
                            className="bg-primary text-on-primary rounded-lg py-1.5 px-3 text-xs font-bold active:scale-95 transition-all flex items-center gap-1"
                          >
                            Confirmer
                          </button>
                          <button
                            onClick={() => setConfirmingReimportId(null)}
                            className="bg-surface-container text-on-surface-variant rounded-lg py-1.5 px-3 text-xs font-bold active:scale-95 transition-all"
                          >
                            Annuler
                          </button>
                        </span>
                      ) : (
                        <button
                          onClick={() => setConfirmingReimportId(c.id)}
                          disabled={isImporting}
                          className="bg-surface-container text-on-surface-variant rounded-lg py-1.5 px-3 text-xs font-bold active:scale-95 transition-all disabled:opacity-50 flex items-center gap-1"
                        >
                          <span className="material-symbols-outlined text-base leading-none">
                            refresh
                          </span>
                          Réimporter
                        </button>
                      )}
                      <button
                        onClick={() => enrichMutation.mutate(c.id)}
                        disabled={isEnriching}
                        className="bg-surface-container text-on-surface-variant rounded-lg py-1.5 px-3 text-xs font-bold active:scale-95 transition-all disabled:opacity-50 flex items-center gap-1"
                      >
                        <span className="material-symbols-outlined text-base leading-none">
                          description
                        </span>
                        {enrichJobStatus === "queued"
                          ? "En file d'attente"
                          : enrichJobStatus === "running"
                            ? "Enrichissement..."
                            : "Enrichir PDF"}
                      </button>
                      {confirmingDeleteId === c.id ? (
                        <span className="flex items-center gap-1">
                          <button
                            onClick={() => {
                              deleteMutation.mutate(c.id);
                              setConfirmingDeleteId(null);
                            }}
                            className="bg-error text-on-error rounded-lg py-1.5 px-3 text-xs font-bold active:scale-95 transition-all flex items-center gap-1"
                          >
                            Confirmer
                          </button>
                          <button
                            onClick={() => setConfirmingDeleteId(null)}
                            className="bg-surface-container text-on-surface-variant rounded-lg py-1.5 px-3 text-xs font-bold active:scale-95 transition-all"
                          >
                            Annuler
                          </button>
                        </span>
                      ) : (
                        <button
                          onClick={() => setConfirmingDeleteId(c.id)}
                          className="bg-error-container/50 text-on-error-container rounded-lg py-1.5 px-3 text-xs font-bold flex items-center gap-1"
                        >
                          <span className="material-symbols-outlined text-base leading-none">
                            delete
                          </span>
                          Supprimer
                        </button>
                      )}
                    </div>

                    {/* Mobile: polling toggle + overflow menu */}
                    <div className="flex items-center gap-1 lg:hidden shrink-0 self-end">
                      <button
                        onClick={() => pollingMutation.mutate({ id: c.id, enabled: !c.polling_enabled })}
                        disabled={pollingMutation.isPending}
                        className={`rounded-lg py-1.5 px-2 text-xs font-bold active:scale-95 transition-all flex items-center gap-1 ${
                          c.polling_enabled
                            ? "bg-primary text-on-primary"
                            : "bg-surface-container text-on-surface-variant"
                        }`}
                        title={c.polling_enabled ? "Suivi automatique actif" : "Activer le suivi automatique"}
                      >
                        <span className="material-symbols-outlined text-base leading-none">sync</span>
                      </button>
                      <div className="relative" ref={openMenuId === c.id ? menuRef : undefined}>
                        <button
                          onClick={() => setOpenMenuId(openMenuId === c.id ? null : c.id)}
                          className="rounded-lg p-1.5 text-on-surface-variant hover:bg-surface-container transition-colors"
                        >
                          <span className="material-symbols-outlined text-xl leading-none">more_vert</span>
                        </button>
                        {openMenuId === c.id && (
                          <div className="absolute right-0 top-full mt-1 bg-surface-container-lowest rounded-xl shadow-lg z-30 w-[220px] py-1" style={{ maxWidth: 'calc(100vw - 2rem)' }}>
                          {!c.metadata_confirmed && (
                            <button
                              onClick={() => { confirmMutation.mutate(c.id); setOpenMenuId(null); }}
                              className="w-full flex items-center gap-2 px-4 py-2.5 text-xs text-on-surface hover:bg-surface-container transition-colors text-left"
                            >
                              <span className="material-symbols-outlined text-base leading-none">check</span>
                              Valider les métadonnées
                            </button>
                          )}
                          <button
                            onClick={() => {
                              setEditingId(editingId === c.id ? null : c.id);
                              setEditForm({ name: c.name ?? "", city: c.city ?? "", country: c.country ?? "", competition_type: c.competition_type ?? "", season: c.season ?? "", ligue: c.ligue ?? "" });
                              setOpenMenuId(null);
                            }}
                            className="w-full flex items-center gap-2 px-4 py-2.5 text-xs text-on-surface hover:bg-surface-container transition-colors text-left"
                          >
                            <span className="material-symbols-outlined text-base leading-none">edit</span>
                            Modifier
                          </button>
                          <button
                            onClick={() => { importMutation.mutate(c.id); setOpenMenuId(null); }}
                            disabled={isImporting}
                            className="w-full flex items-center gap-2 px-4 py-2.5 text-xs text-on-surface hover:bg-surface-container transition-colors text-left disabled:opacity-50"
                          >
                            <span className="material-symbols-outlined text-base leading-none">download</span>
                            {importJobStatus === "queued" ? "En file d'attente" : importJobStatus === "running" ? "Importation..." : "Importer"}
                          </button>
                          <button
                            onClick={() => {
                              if (confirmingReimportId === c.id) {
                                reimportMutation.mutate(c.id);
                                setConfirmingReimportId(null);
                              } else {
                                setConfirmingReimportId(c.id);
                              }
                              setOpenMenuId(null);
                            }}
                            disabled={isImporting}
                            className="w-full flex items-center gap-2 px-4 py-2.5 text-xs text-on-surface hover:bg-surface-container transition-colors text-left disabled:opacity-50"
                          >
                            <span className="material-symbols-outlined text-base leading-none">refresh</span>
                            Réimporter
                          </button>
                          <button
                            onClick={() => { enrichMutation.mutate(c.id); setOpenMenuId(null); }}
                            disabled={isEnriching}
                            className="w-full flex items-center gap-2 px-4 py-2.5 text-xs text-on-surface hover:bg-surface-container transition-colors text-left disabled:opacity-50"
                          >
                            <span className="material-symbols-outlined text-base leading-none">description</span>
                            {enrichJobStatus === "queued" ? "En file d'attente" : enrichJobStatus === "running" ? "Enrichissement..." : "Enrichir PDF"}
                          </button>
                          <div className="my-1 border-t border-outline-variant/30" />
                          <button
                            onClick={() => {
                              if (confirmingDeleteId === c.id) {
                                deleteMutation.mutate(c.id);
                                setConfirmingDeleteId(null);
                              } else {
                                setConfirmingDeleteId(c.id);
                              }
                              setOpenMenuId(null);
                            }}
                            className="w-full flex items-center gap-2 px-4 py-2.5 text-xs text-error hover:bg-error-container/20 transition-colors text-left"
                          >
                            <span className="material-symbols-outlined text-base leading-none">delete</span>
                            Supprimer
                          </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>

              {/* Inline metadata editor */}
              {editingId === c.id && (
                <div className="bg-surface-container-lowest rounded-xl shadow-sm p-5 mt-1 border-l-[3px] border-primary">
                  <div className="mb-3">
                    <label className="text-[10px] uppercase tracking-wider text-on-surface-variant block mb-1">Nom</label>
                    <input
                      value={editForm.name}
                      onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                      className={inputClass}
                      placeholder="Nom de la compétition"
                    />
                  </div>
                  <div className="flex gap-3 flex-wrap">
                    <div className="flex-1 min-w-[150px]">
                      <label className="text-[10px] uppercase tracking-wider text-on-surface-variant block mb-1">Type</label>
                      <select
                        value={editForm.competition_type}
                        onChange={(e) => setEditForm((f) => ({ ...f, competition_type: e.target.value }))}
                        className={inputClass}
                      >
                        <option value="">—</option>
                        {Object.entries(COMPETITION_TYPES).map(([code, label]) => (
                          <option key={code} value={code}>{label}</option>
                        ))}
                      </select>
                    </div>
                    <div className="flex-1 min-w-[150px]">
                      <label className="text-[10px] uppercase tracking-wider text-on-surface-variant block mb-1">Ville</label>
                      <input
                        value={editForm.city}
                        onChange={(e) => setEditForm((f) => ({ ...f, city: e.target.value }))}
                        className={inputClass}
                        placeholder="Ville"
                      />
                    </div>
                    <div className="flex-1 min-w-[150px]">
                      <label className="text-[10px] uppercase tracking-wider text-on-surface-variant block mb-1">Pays</label>
                      <input
                        value={editForm.country}
                        onChange={(e) => setEditForm((f) => ({ ...f, country: e.target.value }))}
                        className={inputClass}
                        placeholder="Pays"
                      />
                    </div>
                    <div className="flex-1 min-w-[120px]">
                      <label className="text-[10px] uppercase tracking-wider text-on-surface-variant block mb-1">Saison</label>
                      <input
                        value={editForm.season}
                        onChange={(e) => setEditForm((f) => ({ ...f, season: e.target.value }))}
                        className={inputClass}
                        placeholder="2025-2026"
                      />
                    </div>
                    <div className="flex-1 min-w-[150px]">
                      <label className="text-[10px] uppercase tracking-wider text-on-surface-variant block mb-1">Ligue</label>
                      <select
                        value={editForm.ligue}
                        onChange={(e) => setEditForm((f) => ({ ...f, ligue: e.target.value }))}
                        className={inputClass}
                      >
                        <option value="">—</option>
                        {Object.entries(LIGUES).map(([code, label]) => (
                          <option key={code} value={code}>{label}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="flex gap-2 mt-3 justify-end">
                    <button
                      onClick={() => setEditingId(null)}
                      className="bg-surface-container text-on-surface-variant rounded-lg py-1.5 px-4 text-xs font-bold"
                    >
                      Annuler
                    </button>
                    <button
                      onClick={() => updateMutation.mutate({ id: c.id, data: editForm })}
                      disabled={updateMutation.isPending}
                      className="bg-primary text-on-primary rounded-lg py-1.5 px-4 text-xs font-bold active:scale-95 transition-all disabled:opacity-50"
                    >
                      {updateMutation.isPending ? "Enregistrement..." : "Enregistrer"}
                    </button>
                  </div>
                </div>
              )}

              {/* Inline import result notification */}
              {result && !isDismissed && (
                <div className="px-5 pt-2">
                  {result.errors.length > 0 ? (
                    <div className="border-l-4 border-error pl-3 py-1">
                      <div className="flex items-center gap-2">
                        <span className="inline-block w-2 h-2 rounded-full bg-error shrink-0" />
                        <p className="text-xs text-error font-medium">
                          Importé {result.scores_imported}/{result.scores_imported + result.errors.length} événements · {result.errors.length} erreur(s)
                        </p>
                        <button
                          onClick={() => setErrorModalCompId(c.id)}
                          className="text-xs text-error/70 hover:text-error underline underline-offset-2 transition-colors"
                        >
                          Voir les détails
                        </button>
                        <button
                          onClick={() =>
                            dismissImportResult(c.id)
                          }
                          className="text-on-surface-variant hover:text-on-surface transition-colors ml-auto"
                          aria-label="Fermer"
                        >
                          <span className="material-symbols-outlined text-sm leading-none">
                            close
                          </span>
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="inline-block w-2 h-2 rounded-full bg-primary shrink-0" />
                      <p className="text-xs text-primary font-medium">
                        {result.events_found} événements · {result.scores_imported} scores importés · {result.scores_skipped} ignorés
                      </p>
                      <button
                        onClick={() =>
                          dismissImportResult(c.id)
                        }
                        className="text-on-surface-variant hover:text-on-surface transition-colors"
                        aria-label="Fermer"
                      >
                        <span className="material-symbols-outlined text-sm leading-none">
                          close
                        </span>
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Inline enrich result notification */}
              {enrichResult && !isEnrichDismissed && (
                <div className="px-5 pt-2">
                  {enrichResult.errors.length > 0 ? (
                    <div className="border-l-4 border-error pl-3 py-1">
                      <div className="flex items-center gap-2">
                        <span className="inline-block w-2 h-2 rounded-full bg-error shrink-0" />
                        <p className="text-xs text-error font-medium">
                          {enrichResult.pdfs_downloaded} PDF téléchargés · {enrichResult.scores_enriched} scores enrichis · {enrichResult.errors.length} erreur(s)
                        </p>
                        <button
                          onClick={() => setErrorModalCompId(c.id)}
                          className="text-xs text-error/70 hover:text-error underline underline-offset-2 transition-colors"
                        >
                          Voir les détails
                        </button>
                        <button
                          onClick={() =>
                            dismissEnrichResult(c.id)
                          }
                          className="text-on-surface-variant hover:text-on-surface transition-colors ml-auto"
                          aria-label="Fermer"
                        >
                          <span className="material-symbols-outlined text-sm leading-none">close</span>
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="inline-block w-2 h-2 rounded-full bg-primary shrink-0" />
                      <p className="text-xs text-primary font-medium">
                        {enrichResult.pdfs_downloaded} PDF téléchargés · {enrichResult.scores_enriched} scores enrichis
                      </p>
                      <button
                        onClick={() =>
                          dismissEnrichResult(c.id)
                        }
                        className="text-on-surface-variant hover:text-on-surface transition-colors"
                        aria-label="Fermer"
                      >
                        <span className="material-symbols-outlined text-sm leading-none">close</span>
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Inline failed job error notification */}
              {failedError && (
                <div className="px-5 pt-2">
                  <div className="border-l-4 border-error pl-3 py-1">
                    <div className="flex items-center gap-2">
                      <span className="inline-block w-2 h-2 rounded-full bg-error shrink-0" />
                      <p className="text-xs text-error font-medium">
                        Échec de l'{failedError.type === "enrich" ? "enrichissement" : "importation"}
                      </p>
                      <button
                        onClick={() => setErrorModalCompId(c.id)}
                        className="text-xs text-error/70 hover:text-error underline underline-offset-2 transition-colors"
                      >
                        Voir les détails
                      </button>
                      <button
                        onClick={() => dismissFailedError(c.id)}
                        className="text-on-surface-variant hover:text-on-surface transition-colors ml-auto"
                        aria-label="Fermer"
                      >
                        <span className="material-symbols-outlined text-sm leading-none">close</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Error detail modal */}
      {errorModalCompId !== null && (() => {
        const comp = competitions?.find((c) => c.id === errorModalCompId);
        if (!comp) return null;
        const modalImportResult = importResults[errorModalCompId];
        const modalEnrichResult = enrichResults[errorModalCompId];
        const modalFailedError = failedErrors[errorModalCompId];
        return (
          <ErrorDetailModal
            competitionName={comp.name}
            importResult={modalImportResult?.errors.length ? modalImportResult : undefined}
            enrichResult={modalEnrichResult?.errors.length ? modalEnrichResult : undefined}
            failedError={modalFailedError}
            onClose={() => setErrorModalCompId(null)}
          />
        );
      })()}
    </div>
  );
}
