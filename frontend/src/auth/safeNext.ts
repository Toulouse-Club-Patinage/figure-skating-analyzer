/** Cible de retour après connexion : chemin interne uniquement (pas de redirection ouverte). */
export function safeNext(next: string | null): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/";
  return next;
}
