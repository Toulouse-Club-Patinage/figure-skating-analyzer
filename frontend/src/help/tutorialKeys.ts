/** Clés de stockage du tutoriel, partagées entre HelpContext (qui les lit et
 *  les écrit) et AuthContext (qui doit les effacer à la déconnexion pour ne
 *  pas laisser l'état d'un utilisateur fuiter vers le suivant sur un poste
 *  partagé). Centralisées ici pour éviter que les deux fichiers ne dérivent. */
export const INVITE_DISMISSED_KEY = "tutorial_invite_dismissed";
export const SCREENS_SEEN_KEY = "tutorial_screens_seen";
export const TOUR_MODE_KEY = "tutorial_mode_active";
