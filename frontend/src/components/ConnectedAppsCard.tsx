import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";

function formatDate(epoch: number | null): string {
  return epoch ? new Date(epoch * 1000).toLocaleDateString("fr-FR") : "jamais";
}

export default function ConnectedAppsCard() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [all, setAll] = useState(false);
  const queryClient = useQueryClient();
  const { data: grants = [] } = useQuery({
    queryKey: ["oauth-grants", all],
    queryFn: () => api.oauth.grants(all),
  });
  const revoke = useMutation({
    mutationFn: api.oauth.revoke,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["oauth-grants"] }),
  });

  return (
    <div className="bg-surface-container-lowest rounded-xl shadow-sm p-6 max-w-md mt-6">
      <h2 className="font-headline font-bold text-on-surface text-sm mb-1">Applications connectées</h2>
      <p className="text-xs text-on-surface-variant mb-4">
        Applications (Claude) autorisées à lire vos données de compétition.
      </p>
      {isAdmin && (
        <label className="flex items-center gap-2 text-xs text-on-surface-variant mb-3">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
          Voir toutes les autorisations du club
        </label>
      )}
      {grants.length === 0 ? (
        <p className="text-sm text-on-surface-variant">Aucune application connectée.</p>
      ) : (
        <ul className="space-y-2">
          {grants.map((g) => (
            <li key={g.family_id} className="flex items-center justify-between bg-surface-container rounded-lg px-3 py-2">
              <div>
                <p className="text-sm text-on-surface">
                  {g.client_name}
                  {all && <span className="text-on-surface-variant"> — {g.user_display_name}</span>}
                </p>
                <p className="text-xs text-on-surface-variant">
                  Autorisé le <span className="font-mono">{formatDate(g.granted_at)}</span> · dernière utilisation{" "}
                  <span className="font-mono">{formatDate(g.last_used_at)}</span>
                </p>
              </div>
              <button
                onClick={() => revoke.mutate(g.family_id)}
                disabled={revoke.isPending}
                className="text-xs font-bold text-error disabled:opacity-50"
              >
                Révoquer
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
