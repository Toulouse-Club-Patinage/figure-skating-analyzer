import { useState } from "react";
import { Link, Navigate, useLocation, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";

export default function AuthorizePage() {
  const { user, loading } = useAuth();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const requestId = searchParams.get("demande") ?? "";
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const { data: info, isLoading, isError } = useQuery({
    queryKey: ["oauth-request", requestId],
    queryFn: () => api.oauth.getRequest(requestId),
    enabled: !!user && !!requestId,
    retry: false,
  });

  if (loading) return null;
  if (!user) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }

  async function decide(approve: boolean) {
    setSubmitting(true);
    setError("");
    try {
      const { redirect_url } = await api.oauth.decide(requestId, approve);
      window.location.assign(redirect_url);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "";
      setError(
        msg.includes("409")
          ? "Vous devez d'abord changer votre mot de passe temporaire."
          : msg.includes("404")
          ? "Cette demande a expiré. Relancez la connexion depuis Claude."
          : "Une erreur est survenue."
      );
      setSubmitting(false);
    }
  }

  const scopeText =
    user.role === "skater"
      ? "aux résultats de compétition de vos patineurs rattachés"
      : "aux résultats de compétition et aux statistiques du club";

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center p-4">
      <div className="bg-surface-container-lowest rounded-xl shadow-sm p-8 max-w-md w-full">
        <div className="flex items-center gap-3 mb-6">
          <span className="material-symbols-outlined text-primary text-3xl">key</span>
          <h1 className="font-headline text-xl font-bold text-on-surface">Autoriser l'accès</h1>
        </div>

        {!requestId || isError ? (
          <p className="text-sm text-error">Cette demande a expiré ou est invalide. Relancez la connexion depuis Claude.</p>
        ) : isLoading || !info ? (
          <p className="text-sm text-on-surface-variant">Chargement…</p>
        ) : (
          <>
            <p className="text-sm text-on-surface mb-4">
              <span className="font-bold">{info.client_name}</span> demande un accès en{" "}
              <span className="font-bold">lecture seule</span> {scopeText}.
            </p>
            <div className="bg-surface-container rounded-lg p-4 text-xs text-on-surface-variant space-y-1 mb-4">
              <p>Connecté en tant que <span className="text-on-surface font-semibold">{user.display_name}</span></p>
              <p>Redirection vers <span className="font-mono text-on-surface">{info.redirect_host}</span></p>
              <p>Les données d'entraînement ne sont jamais partagées.</p>
            </div>
            {info.is_loopback && (
              <p className="text-xs text-error bg-error/10 rounded-lg p-3 mb-4">
                Cette demande provient d'un programme sur votre ordinateur (Claude Code). N'autorisez que si vous
                venez de lancer la connexion vous-même.
              </p>
            )}
            {error && (
              <p className="text-xs text-error mb-4">
                {error}{" "}
                {error.includes("mot de passe") && <Link to="/profil" className="underline">Mon compte</Link>}
              </p>
            )}
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => decide(false)}
                disabled={submitting}
                className="px-4 py-2 rounded-xl text-sm font-bold text-on-surface-variant bg-surface-container disabled:opacity-50"
              >
                Refuser
              </button>
              <button
                onClick={() => decide(true)}
                disabled={submitting}
                className="px-4 py-2 bg-primary text-on-primary rounded-xl text-sm font-bold disabled:opacity-50"
              >
                {submitting ? "…" : "Autoriser"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
