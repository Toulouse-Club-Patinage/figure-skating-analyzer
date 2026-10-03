import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";

export const REQUEST_STATUS_LABELS: Record<string, string> = {
  created: "Compte créé",
  already_linked: "Déjà rattaché",
  pending_admin: "En attente de validation",
  rejected: "Refusée",
  expired: "Expirée",
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  // Le backend renvoie des dates naïves en UTC (sans suffixe Z)
  const date = new Date(iso.endsWith("Z") ? iso : iso + "Z");
  return date.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
}

export default function AccountRequestsHistoryModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const { data: history = [], isLoading } = useQuery({
    queryKey: ["account-requests-history"],
    queryFn: api.admin.accountRequests.history,
  });

  const unarchive = useMutation({
    mutationFn: (id: number) => api.admin.accountRequests.unarchive(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["account-requests"] });
      qc.invalidateQueries({ queryKey: ["account-requests-history"] });
    },
  });

  const needle = search.trim().toLowerCase();
  const filtered = needle
    ? history.filter(
        (r) =>
          r.display_name.toLowerCase().includes(needle) ||
          r.email.toLowerCase().includes(needle) ||
          r.licence_numbers.some((l) => l.includes(needle)),
      )
    : history;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-surface-container-lowest rounded-2xl shadow-xl w-full max-w-4xl max-h-[85vh] flex flex-col mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4">
          <div>
            <h2 className="font-headline font-bold text-on-surface text-base">
              Historique des demandes de compte
            </h2>
            <p className="text-xs text-on-surface-variant mt-0.5">
              {history.length} demande(s), archivées comprises
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-on-surface-variant hover:text-on-surface transition-colors p-1 rounded-lg hover:bg-surface-container"
            aria-label="Fermer"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="px-6 pb-3">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher un nom, un email ou une licence…"
            className="w-full px-3 py-2 bg-surface-container-low rounded-xl text-on-surface text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>

        <div className="overflow-y-auto px-6 pb-6">
          {isLoading ? (
            <p className="text-sm text-on-surface-variant">Chargement…</p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-on-surface-variant">Aucune demande.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-xs">
                <thead className="text-left text-on-surface-variant uppercase tracking-wider">
                  <tr>
                    <th className="py-2 pr-3 font-semibold">Demandeur</th>
                    <th className="py-2 px-3 font-semibold">Licences</th>
                    <th className="py-2 px-3 font-semibold">Statut</th>
                    <th className="py-2 px-3 font-semibold">Reçue le</th>
                    <th className="py-2 px-3 font-semibold">Archivée le</th>
                    <th className="py-2 pl-3" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => (
                    <tr
                      key={r.id}
                      className={`even:bg-surface-container-low ${r.archived_at ? "text-on-surface-variant" : "text-on-surface"}`}
                    >
                      <td className="py-2 pr-3">
                        <p className="font-medium">{r.display_name}</p>
                        <p className="text-on-surface-variant">{r.email}</p>
                        {r.reject_reason && <p className="text-error mt-0.5">{r.reject_reason}</p>}
                      </td>
                      <td className="py-2 px-3 font-mono">{r.licence_numbers.join(", ")}</td>
                      <td className="py-2 px-3 whitespace-nowrap">
                        {REQUEST_STATUS_LABELS[r.status] ?? r.status}
                      </td>
                      <td className="py-2 px-3 whitespace-nowrap">{formatDate(r.created_at)}</td>
                      <td className="py-2 px-3 whitespace-nowrap">{formatDate(r.archived_at)}</td>
                      <td className="py-2 pl-3 text-right">
                        {r.archived_at && (
                          <button
                            onClick={() => unarchive.mutate(r.id)}
                            disabled={unarchive.isPending}
                            className="inline-flex items-center gap-1 text-primary font-semibold hover:underline disabled:opacity-50 whitespace-nowrap"
                          >
                            <span className="material-symbols-outlined text-sm">unarchive</span>
                            Désarchiver
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
