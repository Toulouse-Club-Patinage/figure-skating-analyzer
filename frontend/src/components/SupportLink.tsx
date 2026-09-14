import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";

/**
 * Lien de contact support « anti-moissonnage ».
 *
 * Les robots collecteurs d'adresses lisent le HTML servi : un `mailto:` écrit
 * en clair dans le markup est exactement ce qu'ils cherchent. Ici l'adresse
 * n'est jamais rendue — ni dans le texte, ni dans un href. Elle arrive encodée
 * depuis l'API et n'est décodée qu'au moment du clic, pour ouvrir le client
 * mail. Un crawler qui n'exécute pas de JS ne voit qu'un <button> ; celui qui
 * en exécute ne trouve toujours aucune adresse tant que personne ne clique.
 */

/** Décode l'adresse au dernier moment. Séparée pour n'être appelée qu'au clic. */
function decodeAddress(encoded: string): string {
  // ROT13 sur les lettres + le `@` remplacé par un marqueur : suffisant pour
  // que l'adresse ne soit pas reconnaissable par une regex de moissonneur.
  return encoded
    .replace(/\(at\)/g, "@")
    .replace(/[a-zA-Z]/g, (c) => {
      const base = c <= "Z" ? 65 : 97;
      return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
    });
}

interface SupportLinkProps {
  /** Rendu compact : icône seule (barre latérale repliée). */
  iconOnly?: boolean;
  /** Libellé affiché. */
  label?: string;
  className?: string;
}

export default function SupportLink({
  iconOnly = false,
  label = "Besoin d'aide ?",
  className = "",
}: SupportLinkProps) {
  // Adresse révélée en secours, pour copie manuelle. Aucune page ne peut
  // savoir si un `mailto:` a réellement ouvert un client mail : on ne devine
  // donc pas, on laisse l'utilisateur demander l'adresse s'il en a besoin.
  const [revealed, setRevealed] = useState(false);

  const { data: config } = useQuery({
    queryKey: ["config"],
    queryFn: api.config.get,
    staleTime: Infinity,
  });

  const encoded = config?.support_email_encoded;

  // Pas d'adresse configurée : on n'affiche rien plutôt qu'un lien mort.
  if (!encoded) return null;

  function handleClick() {
    const address = decodeAddress(encoded!);
    const subject = encodeURIComponent(
      `[${config?.club_short || "Support"}] Demande d'assistance`
    );
    // Navigation directe : le href n'existe à aucun moment dans le DOM.
    window.location.href = `mailto:${address}?subject=${subject}`;
  }

  if (iconOnly) {
    return (
      <button
        type="button"
        onClick={handleClick}
        title={label}
        aria-label={label}
        className={`text-on-surface-variant hover:text-on-surface transition-colors ${className}`}
      >
        <span className="material-symbols-outlined text-lg">mail</span>
      </button>
    );
  }

  return (
    <div className={`inline-flex flex-col items-center gap-0.5 ${className}`}>
      <button
        type="button"
        onClick={handleClick}
        className="flex items-center gap-2 text-xs text-on-surface-variant hover:text-on-surface transition-colors"
      >
        <span className="material-symbols-outlined text-base">mail</span>
        <span>{label}</span>
      </button>

      {/* Secours : le bouton principal reste en place, l'adresse s'ajoute
          à côté sans jamais le remplacer. */}
      {revealed ? (
        <span
          className="text-[11px] text-on-surface-variant select-all"
          title="Sélectionnez pour copier"
        >
          {decodeAddress(encoded)}
        </span>
      ) : (
        <button
          type="button"
          onClick={() => setRevealed(true)}
          className="text-[11px] text-on-surface-variant/70 hover:text-on-surface underline underline-offset-2 transition-colors"
        >
          afficher l'adresse
        </button>
      )}
    </div>
  );
}
