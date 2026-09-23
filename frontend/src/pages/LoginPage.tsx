import { useState, useEffect, useRef, useCallback, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../auth/AuthContext";
import { api } from "../api/client";
import SupportLink from "../components/SupportLink";
import { safeNext } from "../auth/safeNext";

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: Record<string, unknown>) => void;
          renderButton: (el: HTMLElement, config: Record<string, unknown>) => void;
        };
      };
    };
  }
}

export default function LoginPage() {
  const { login, loginWithGoogle } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const next = safeNext(searchParams.get("next"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const googleBtnRef = useRef<HTMLDivElement>(null);

  const { data: config } = useQuery({
    queryKey: ["config"],
    queryFn: api.config.get,
    staleTime: Infinity,
  });

  const { data: accountRequests } = useQuery({
    queryKey: ["account-requests-enabled"],
    queryFn: api.config.accountRequestsEnabled,
    staleTime: Infinity,
  });

  const handleGoogleResponse = useCallback(
    async (response: { credential: string }) => {
      setError("");
      setLoading(true);
      try {
        await loginWithGoogle(response.credential);
        navigate(next, { replace: true });
      } catch (err: any) {
        setError(
          err.message?.includes("403")
            ? "Domaine non autorisé"
            : "Erreur de connexion Google"
        );
      } finally {
        setLoading(false);
      }
    },
    [loginWithGoogle, navigate, next]
  );

  useEffect(() => {
    if (!config?.google_client_id || !googleBtnRef.current) return;
    const tryInit = () => {
      if (!window.google?.accounts?.id) return false;
      window.google.accounts.id.initialize({
        client_id: config.google_client_id,
        callback: handleGoogleResponse,
      });
      window.google.accounts.id.renderButton(googleBtnRef.current!, {
        theme: "outline",
        size: "large",
        width: "100%",
        text: "signin_with",
        locale: "fr",
      });
      return true;
    };
    if (!tryInit()) {
      // GIS script may not be loaded yet — retry briefly
      const interval = setInterval(() => {
        if (tryInit()) clearInterval(interval);
      }, 200);
      return () => clearInterval(interval);
    }
  }, [config?.google_client_id, handleGoogleResponse]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(email, password);
      navigate(next, { replace: true });
    } catch (err: any) {
      setError(
        err.message?.includes("401")
          ? "Email ou mot de passe incorrect"
          : err.message?.includes("429")
          ? "Trop de tentatives. Réessayez plus tard."
          : "Erreur de connexion"
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center">
      <div className="w-full max-w-sm">
        {/* Club branding */}
        <div className="text-center mb-8">
          {config?.logo_url ? (
            <img
              src={config.logo_url}
              alt=""
              className="w-16 h-16 mx-auto mb-3 object-contain"
            />
          ) : (
            <span className="material-symbols-outlined text-primary text-5xl">
              sports_score
            </span>
          )}
          <h1 className="font-headline font-bold text-on-surface text-xl mt-2">
            {config?.club_name ?? "SkateLab"}
          </h1>
          <p className="text-on-surface-variant text-sm mt-1">
            Connectez-vous pour continuer
          </p>
        </div>

        {/* Login form */}
        <div className="bg-surface-container-lowest rounded-2xl p-6 shadow-arctic">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-label font-medium text-on-surface-variant mb-1">
                Email
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2 bg-surface-container-low rounded-xl text-on-surface text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="coach@club.fr"
              />
            </div>
            <div>
              <label className="block text-xs font-label font-medium text-on-surface-variant mb-1">
                Mot de passe
              </label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2 bg-surface-container-low rounded-xl text-on-surface text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            {error && (
              <p className="text-error text-xs font-medium">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-primary text-on-primary rounded-xl text-sm font-bold hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {loading ? "Connexion..." : "Se connecter"}
            </button>
          </form>

          {/* Demande de compte — seulement si le club l'a activée */}
          {accountRequests?.enabled && (
            <p className="text-on-surface-variant text-xs text-center mt-4">
              Pas encore de compte ?{" "}
              <Link to="/request-account" className="text-primary font-medium">
                Demander un accès
              </Link>
            </p>
          )}

          {/* Google OAuth — only if configured */}
          {config?.google_client_id && (
            <div className="mt-4 pt-4 border-t border-outline-variant/30">
              <p className="text-on-surface-variant text-xs text-center mb-3">ou</p>
              <div ref={googleBtnRef} className="flex justify-center" />
            </div>
          )}
        </div>

        {/* Recours en cas de blocage : un utilisateur qui ne peut pas se
            connecter n'atteint aucune page interne. */}
        <div className="flex justify-center mt-6">
          <SupportLink label="Un problème pour vous connecter ?" />
        </div>
      </div>
    </div>
  );
}
