import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type JobInfo, type ImportResult, type EnrichResult } from "../api/client";

function parseUTC(iso: string): Date {
  // Backend returns naive ISO strings (no Z suffix) that are actually UTC
  return new Date(iso.endsWith("Z") ? iso : iso + "Z");
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - parseUTC(iso).getTime();
  const sec = Math.floor(diff / 1000);
  const min = Math.floor(sec / 60);
  const hr = Math.floor(min / 60);
  const day = Math.floor(hr / 24);
  if (sec < 60) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  if (hr < 24) return `il y a ${hr} h`;
  return `il y a ${day} j`;
}

function formatFullDate(iso: string): string {
  return parseUTC(iso).toLocaleString("fr-FR", {
    dateStyle: "long",
    timeStyle: "short",
  });
}

function formatDuration(startedAt: string, completedAt: string): string {
  const ms = parseUTC(completedAt).getTime() - parseUTC(startedAt).getTime();
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return `${min}m ${rem}s`;
}

const STATUS_ICONS: Record<string, { icon: string; className: string }> = {
  running: { icon: "progress_activity", className: "text-primary animate-spin" },
  queued: { icon: "schedule", className: "text-on-surface-variant" },
  completed: { icon: "check_circle", className: "text-green-600" },
  failed: { icon: "cancel", className: "text-error" },
  cancelled: { icon: "block", className: "text-on-surface-variant" },
};

const TYPE_LABELS: Record<string, string> = {
  import: "Import",
  reimport: "Réimport",
  enrich: "Enrichissement",
  poll: "Suivi",
};

const TRIGGER_LABELS: Record<string, string> = {
  manual: "manuel",
  auto: "auto",
  bulk: "lot",
};

function resultSummary(job: JobInfo): string {
  if (!job.result) return "";
  if (job.type === "enrich") {
    const r = job.result as EnrichResult;
    return `${r.scores_enriched} score(s) enrichi(s)`;
  }
  const r = job.result as ImportResult;
  return `${r.scores_imported} score(s) importé(s)`;
}

function JobDetailModal({
  job,
  onClose,
}: {
  job: JobInfo;
  onClose: () => void;
}) {
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const r = job.result;
  const isImport = job.type === "import" || job.type === "reimport" || job.type === "poll";
  const isEnrich = job.type === "enrich";
  const importResult = isImport ? (r as ImportResult | null) : null;
  const enrichResult = isEnrich ? (r as EnrichResult | null) : null;

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={(e) => {
        if (e.target === overlayRef.current) onClose();
      }}
    >
      <div className="bg-surface-container-lowest rounded-2xl shadow-xl w-full max-w-lg mx-4 max-h-[80vh] overflow-y-auto">
        <div className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-headline font-bold text-on-surface text-lg">
              Détails de la tâche
            </h3>
            <button
              onClick={onClose}
              className="text-on-surface-variant hover:text-on-surface"
            >
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>

          {/* Metadata */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-on-surface-variant">Type</span>
              <p className="text-on-surface font-medium">
                {TYPE_LABELS[job.type] ?? job.type}
                <span className="ml-1 text-on-surface-variant text-xs">
                  ({TRIGGER_LABELS[job.trigger] ?? job.trigger})
                </span>
              </p>
            </div>
            <div>
              <span className="text-on-surface-variant">Statut</span>
              <p className="text-on-surface font-medium flex items-center gap-1">
                <span
                  className={`material-symbols-outlined text-base ${STATUS_ICONS[job.status]?.className}`}
                >
                  {STATUS_ICONS[job.status]?.icon}
                </span>
                {job.status}
              </p>
            </div>
            <div>
              <span className="text-on-surface-variant">Compétition</span>
              <p className="text-on-surface font-medium">{job.competition_name ?? `#${job.competition_id}`}</p>
            </div>
            <div>
              <span className="text-on-surface-variant">Créé le</span>
              <p className="text-on-surface font-medium">{formatFullDate(job.created_at)}</p>
            </div>
            {job.started_at && (
              <div>
                <span className="text-on-surface-variant">Démarré le</span>
                <p className="text-on-surface font-medium">{formatFullDate(job.started_at)}</p>
              </div>
            )}
            {job.completed_at && (
              <div>
                <span className="text-on-surface-variant">Terminé le</span>
                <p className="text-on-surface font-medium">{formatFullDate(job.completed_at)}</p>
              </div>
            )}
          </div>

          {/* Import result */}
          {importResult && (
            <div className="bg-surface-container-low rounded-xl p-4 space-y-2">
              <h4 className="text-sm font-semibold text-on-surface">Résultat</h4>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <span className="text-on-surface-variant">Épreuves trouvées</span>
                  <p className="font-mono text-on-surface">{importResult.events_found}</p>
                </div>
                <div>
                  <span className="text-on-surface-variant">Scores importés</span>
                  <p className="font-mono text-on-surface">{importResult.scores_imported}</p>
                </div>
                <div>
                  <span className="text-on-surface-variant">Scores ignorés</span>
                  <p className="font-mono text-on-surface">{importResult.scores_skipped}</p>
                </div>
                <div>
                  <span className="text-on-surface-variant">Classements</span>
                  <p className="font-mono text-on-surface">{importResult.category_results_imported}</p>
                </div>
              </div>
              {importResult.errors.length > 0 && (
                <div className="mt-2">
                  <p className="text-xs font-semibold text-error mb-1">Erreurs ({importResult.errors.length})</p>
                  <ul className="text-xs text-error/80 space-y-0.5">
                    {importResult.errors.map((e, i) => (
                      <li key={i}>{e.skater}: {e.error}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Enrich result */}
          {enrichResult && (
            <div className="bg-surface-container-low rounded-xl p-4 space-y-2">
              <h4 className="text-sm font-semibold text-on-surface">Résultat</h4>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <span className="text-on-surface-variant">PDFs téléchargés</span>
                  <p className="font-mono text-on-surface">{enrichResult.pdfs_downloaded}</p>
                </div>
                <div>
                  <span className="text-on-surface-variant">Scores enrichis</span>
                  <p className="font-mono text-on-surface">{enrichResult.scores_enriched}</p>
                </div>
              </div>
              {enrichResult.unmatched.length > 0 && (
                <div className="mt-2">
                  <p className="text-xs font-semibold text-amber-600 mb-1">
                    Non appariés ({enrichResult.unmatched.length})
                  </p>
                  <ul className="text-xs text-on-surface-variant space-y-0.5">
                    {enrichResult.unmatched.map((u, i) => (
                      <li key={i}>{u}</li>
                    ))}
                  </ul>
                </div>
              )}
              {enrichResult.errors.length > 0 && (
                <div className="mt-2">
                  <p className="text-xs font-semibold text-error mb-1">Erreurs ({enrichResult.errors.length})</p>
                  <ul className="text-xs text-error/80 space-y-0.5">
                    {enrichResult.errors.map((e, i) => (
                      <li key={i}>{e.file}: {e.error}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Error */}
          {job.error && !job.result && (
            <div className="bg-error/10 rounded-xl p-4">
              <h4 className="text-sm font-semibold text-error mb-1">Erreur</h4>
              <p className="text-sm text-error/90 whitespace-pre-wrap">{job.error}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ActionMenu({
  job,
  onViewDetails,
  onCancel,
}: {
  job: JobInfo;
  onViewDetails: () => void;
  onCancel: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="p-1 rounded-lg hover:bg-surface-container-high text-on-surface-variant hover:text-on-surface transition-colors"
      >
        <span className="material-symbols-outlined text-xl">more_vert</span>
      </button>
      {open && (
        <div className="absolute right-0 top-8 z-10 bg-surface-container-lowest rounded-xl shadow-lg py-1 min-w-[160px]">
          <button
            onClick={() => {
              onViewDetails();
              setOpen(false);
            }}
            className="w-full text-left px-4 py-2 text-sm text-on-surface hover:bg-surface-container-low flex items-center gap-2"
          >
            <span className="material-symbols-outlined text-base">visibility</span>
            Voir les détails
          </button>
          {job.status === "queued" && (
            <button
              onClick={() => {
                onCancel();
                setOpen(false);
              }}
              className="w-full text-left px-4 py-2 text-sm text-error hover:bg-surface-container-low flex items-center gap-2"
            >
              <span className="material-symbols-outlined text-base">cancel</span>
              Annuler
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function AdminJobsTab() {
  const qc = useQueryClient();
  const [detailJob, setDetailJob] = useState<JobInfo | null>(null);

  const { data: jobs, isLoading } = useQuery({
    queryKey: ["admin-jobs"],
    queryFn: () => api.jobs.list(),
    refetchInterval: 5000,
    refetchOnMount: "always",
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => api.jobs.cancel(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-jobs"] });
    },
  });

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <span className="material-symbols-outlined animate-spin text-primary text-3xl">
          progress_activity
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-headline font-bold text-on-surface text-lg">Tâches</h2>
        <p className="text-sm text-on-surface-variant">
          Historique des 7 derniers jours
        </p>
      </div>

      {!jobs || jobs.length === 0 ? (
        <div className="bg-surface-container-lowest rounded-2xl p-8 text-center">
          <span className="material-symbols-outlined text-4xl text-on-surface-variant mb-2">
            task
          </span>
          <p className="text-on-surface-variant text-sm">Aucune tâche récente</p>
        </div>
      ) : (
        <div className="bg-surface-container-lowest rounded-2xl shadow-arctic">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-semibold text-on-surface-variant uppercase tracking-wider">
                <th className="px-4 py-3 w-10"></th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Compétition</th>
                <th className="px-4 py-3">Début</th>
                <th className="px-4 py-3">Durée</th>
                <th className="px-4 py-3">Résultat</th>
                <th className="px-4 py-3 w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-container-high">
              {jobs.map((job) => {
                const si = STATUS_ICONS[job.status] ?? STATUS_ICONS.queued;
                return (
                  <tr key={job.id} className="hover:bg-surface-container-low/50 transition-colors">
                    <td className="px-4 py-3">
                      <span className={`material-symbols-outlined text-lg ${si.className}`}>
                        {si.icon}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-on-surface">
                      <span className="font-medium">{TYPE_LABELS[job.type] ?? job.type}</span>
                      <span className="ml-1.5 text-xs text-on-surface-variant">
                        {TRIGGER_LABELS[job.trigger] ?? job.trigger}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-on-surface max-w-[200px] truncate">
                      {job.competition_name ?? `#${job.competition_id}`}
                    </td>
                    <td className="px-4 py-3 text-on-surface-variant whitespace-nowrap">
                      {job.started_at ? formatRelativeTime(job.started_at) : "En attente"}
                    </td>
                    <td
                      className="px-4 py-3 font-mono text-on-surface-variant whitespace-nowrap"
                      title={job.completed_at ? formatFullDate(job.completed_at) : undefined}
                    >
                      {job.started_at && job.completed_at
                        ? formatDuration(job.started_at, job.completed_at)
                        : job.started_at
                          ? "..."
                          : "—"}
                    </td>
                    <td className="px-4 py-3 text-on-surface-variant max-w-[180px] truncate">
                      {job.error
                        ? <span className="text-error">{job.error}</span>
                        : resultSummary(job)}
                    </td>
                    <td className="px-4 py-3">
                      <ActionMenu
                        job={job}
                        onViewDetails={() => setDetailJob(job)}
                        onCancel={() => cancelMutation.mutate(job.id)}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {detailJob && (
        <JobDetailModal job={detailJob} onClose={() => setDetailJob(null)} />
      )}
    </div>
  );
}
