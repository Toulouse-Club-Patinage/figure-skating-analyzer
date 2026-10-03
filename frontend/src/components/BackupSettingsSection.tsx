import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type BackupArchive } from "../api/client";

const inputCls =
  "w-full px-3 py-2 bg-surface-container-low rounded-xl text-on-surface text-sm focus:outline-none focus:ring-2 focus:ring-primary";

const KIND_LABELS: Record<string, string> = {
  auto: "Automatique",
  manuel: "Manuelle",
  "avant-reinit": "Avant réinitialisation",
  "avant-restauration": "Avant restauration",
};

/** Extrait le `detail` d'une erreur d'API (« 400 Bad Request: {"detail": …} »). */
function errorMessage(err: unknown): string {
  const text = String(err instanceof Error ? err.message : err);
  const match = text.match(/\{.*\}$/s);
  if (match) {
    try {
      const body = JSON.parse(match[0]);
      if (typeof body.detail === "string") return body.detail;
    } catch {
      /* message brut */
    }
  }
  return text;
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" });
}

type RestoreTarget = { kind: "server"; archive: BackupArchive } | { kind: "upload"; file: File };

export default function BackupSettingsSection() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "backups"],
    queryFn: () => api.admin.backups.status(),
  });

  const [enabled, setEnabled] = useState(false);
  const [time, setTime] = useState("03:00");
  const [retention, setRetention] = useState(14);
  useEffect(() => {
    if (!data) return;
    setEnabled(data.settings.enabled);
    setTime(data.settings.time);
    setRetention(data.settings.retention);
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: () => api.admin.backups.updateSettings({ enabled, time, retention }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "backups"] }),
  });

  const runMutation = useMutation({
    mutationFn: () => api.admin.backups.run(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "backups"] }),
  });

  const [restoreTarget, setRestoreTarget] = useState<RestoreTarget | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const restoreMutation = useMutation({
    mutationFn: (target: RestoreTarget) =>
      target.kind === "server"
        ? api.admin.backups.restore(target.archive.name)
        : api.admin.backups.restoreUpload(target.file),
    onSuccess: () => {
      setRestoreTarget(null);
      setConfirmText("");
      qc.invalidateQueries();
    },
  });

  const closeRestore = () => {
    setRestoreTarget(null);
    setConfirmText("");
    restoreMutation.reset();
  };

  const dirty =
    !!data &&
    (enabled !== data.settings.enabled ||
      time !== data.settings.time ||
      retention !== data.settings.retention);

  if (isLoading || !data) {
    return (
      <section className="bg-surface-container-lowest rounded-2xl p-6 shadow-arctic">
        <h2 className="font-headline font-bold text-on-surface text-lg mb-2">Sauvegardes</h2>
        <p className="text-sm text-on-surface-variant">Chargement…</p>
      </section>
    );
  }

  const last = data.settings;

  return (
    <section className="bg-surface-container-lowest rounded-2xl p-6 shadow-arctic">
      <h2 className="font-headline font-bold text-on-surface text-lg mb-1">Sauvegardes</h2>
      <p className="text-xs text-on-surface-variant mb-4">
        Archive de la base de données et du logo, conservée sur le serveur.
      </p>

      {!data.available ? (
        <p className="text-sm text-on-surface-variant">
          Sauvegarde indisponible : la base de données n'est pas un fichier SQLite.
        </p>
      ) : (
        <>
          {/* Réglages */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-2xl items-end">
            <label className="flex items-center gap-3 text-sm text-on-surface sm:pb-2">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                className="w-4 h-4 accent-primary"
              />
              Sauvegarde quotidienne
            </label>
            <div>
              <label className="block text-xs font-semibold text-on-surface-variant mb-1">
                Heure ({data.timezone})
              </label>
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className={inputCls}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-on-surface-variant mb-1">
                Archives conservées (par type)
              </label>
              <input
                type="number"
                min={1}
                max={365}
                value={retention}
                onChange={(e) => setRetention(Number(e.target.value))}
                className={inputCls}
              />
            </div>
          </div>
          <div className="flex items-center gap-3 mt-4">
            <button
              onClick={() => saveMutation.mutate()}
              disabled={!dirty || saveMutation.isPending}
              className="px-4 py-2 bg-primary text-on-primary rounded-xl text-sm font-bold hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {saveMutation.isPending ? "Enregistrement..." : "Enregistrer"}
            </button>
            {saveMutation.isError && (
              <p className="text-xs text-error">{errorMessage(saveMutation.error)}</p>
            )}
          </div>

          {/* Dernière sauvegarde automatique */}
          <div className="mt-6 p-4 rounded-xl bg-surface-container-low text-sm">
            {last.last_run_at ? (
              <div className="flex items-start gap-2">
                <span
                  className={`material-symbols-outlined text-base ${
                    last.last_status === "ok" ? "text-primary" : "text-error"
                  }`}
                >
                  {last.last_status === "ok" ? "check_circle" : "error"}
                </span>
                <div>
                  <p className="text-on-surface">
                    Dernière sauvegarde automatique : {formatDate(last.last_run_at)}
                    {last.last_status === "ok" ? "" : " — échec"}
                  </p>
                  {last.last_error && (
                    <p className="text-xs text-error mt-1 font-mono break-all">{last.last_error}</p>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-on-surface-variant">
                Aucune sauvegarde automatique pour l'instant
                {data.settings.enabled ? "." : " (désactivée)."}
              </p>
            )}
          </div>

          {/* Actions */}
          <div className="flex flex-wrap items-center gap-3 mt-6">
            <button
              onClick={() => runMutation.mutate()}
              disabled={runMutation.isPending}
              className="px-4 py-2 bg-primary text-on-primary rounded-xl text-sm font-bold hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              <span className="material-symbols-outlined text-sm">backup</span>
              {runMutation.isPending ? "Sauvegarde..." : "Sauvegarder maintenant"}
            </button>
            <button
              onClick={() => fileInput.current?.click()}
              className="px-4 py-2 bg-surface-container-high text-on-surface rounded-xl text-sm font-bold hover:bg-surface-container-highest transition-colors flex items-center gap-2"
            >
              <span className="material-symbols-outlined text-sm">upload_file</span>
              Restaurer depuis un fichier
            </button>
            <input
              ref={fileInput}
              type="file"
              accept=".tar.gz,.tgz,application/gzip"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) setRestoreTarget({ kind: "upload", file });
                e.target.value = "";
              }}
            />
          </div>
          {runMutation.isError && (
            <p className="text-xs text-error mt-2">{errorMessage(runMutation.error)}</p>
          )}
          {restoreMutation.isSuccess && (
            <p className="text-xs text-primary mt-2">
              Restauration terminée. L'état précédent a été sauvegardé dans{" "}
              <span className="font-mono">{restoreMutation.data.safety_backup.name}</span>.
            </p>
          )}

          {/* Liste des archives */}
          <h3 className="font-headline font-bold text-on-surface text-sm mt-6 mb-2">
            Archives sur le serveur
          </h3>
          {data.archives.length === 0 ? (
            <p className="text-sm text-on-surface-variant">Aucune archive.</p>
          ) : (
            <ul className="space-y-1">
              {data.archives.map((a) => (
                <li
                  key={a.name}
                  className="flex items-center gap-3 px-3 py-2 rounded-xl bg-surface-container-low text-sm"
                >
                  <span className="text-on-surface w-40 shrink-0">{formatDate(a.created_at)}</span>
                  <span className="text-on-surface-variant flex-1 truncate">
                    {KIND_LABELS[a.kind] ?? a.kind}
                  </span>
                  <span className="font-mono text-xs text-on-surface-variant w-16 text-right">
                    {formatSize(a.size)}
                  </span>
                  <button
                    onClick={() => api.admin.backups.download(a.name)}
                    title="Télécharger"
                    className="p-1 rounded-lg text-on-surface-variant hover:text-primary hover:bg-surface-container-high transition-colors"
                  >
                    <span className="material-symbols-outlined text-base">download</span>
                  </button>
                  <button
                    onClick={() => setRestoreTarget({ kind: "server", archive: a })}
                    title="Restaurer"
                    className="p-1 rounded-lg text-on-surface-variant hover:text-error hover:bg-surface-container-high transition-colors"
                  >
                    <span className="material-symbols-outlined text-base">settings_backup_restore</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {/* Confirmation de restauration */}
      {restoreTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim/60">
          <div className="bg-surface-container-lowest rounded-2xl shadow-xl p-6 max-w-md w-full mx-4 border-2 border-error/30">
            <div className="flex items-center gap-3 mb-4">
              <span className="material-symbols-outlined text-error text-3xl">warning</span>
              <h3 className="font-headline font-bold text-error text-lg">Confirmer la restauration</h3>
            </div>
            <p className="text-on-surface text-sm mb-2">
              Toutes les données actuelles seront <strong>remplacées</strong> par celles de{" "}
              <span className="font-mono text-xs break-all">
                {restoreTarget.kind === "server" ? restoreTarget.archive.name : restoreTarget.file.name}
              </span>
              .
            </p>
            <p className="text-on-surface-variant text-xs mb-4">
              Une sauvegarde de l'état actuel est faite juste avant : la restauration peut être annulée en
              restaurant cette sauvegarde. Les utilisateurs connectés devront peut-être se reconnecter.
            </p>
            <p className="text-on-surface text-sm mb-2">
              Tapez <strong className="font-mono">RESTAURER</strong> pour confirmer :
            </p>
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              className={`${inputCls} mb-4`}
              autoFocus
            />
            <div className="flex justify-end gap-3">
              <button
                onClick={closeRestore}
                className="px-4 py-2 text-on-surface-variant text-sm font-semibold hover:text-on-surface transition-colors"
              >
                Annuler
              </button>
              <button
                onClick={() => restoreMutation.mutate(restoreTarget)}
                disabled={confirmText !== "RESTAURER" || restoreMutation.isPending}
                className="px-4 py-2 bg-error text-on-error rounded-xl text-sm font-bold hover:bg-error/90 transition-colors disabled:opacity-50"
              >
                {restoreMutation.isPending ? "Restauration..." : "Restaurer"}
              </button>
            </div>
            {restoreMutation.isError && (
              <p className="text-error text-xs mt-3">{errorMessage(restoreMutation.error)}</p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
