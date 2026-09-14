import { matchPath } from "react-router-dom";
import type { Audience } from "./content";

export type TourStep = {
  /** Valeur de l'attribut data-tour portée par la cible. */
  target: string;
  title: string;
  body: string;
  /** Chapitre ouvert par « En savoir plus ». */
  chapterId?: string;
  audience: Audience[];
};

export type ScreenTour = {
  /** Motif de route au sens de React Router (`matchPath`). */
  pattern: string;
  /** Onglet concerné, pour les écrans dont le contenu change sans que l'URL
   *  bouge (onglets portés par un `useState`). La page annonce son onglet
   *  actif via `data-tour-tab` ; une entrée sans `tab` couvre l'écran quel que
   *  soit l'onglet, et sert de repli quand aucune entrée ne cible l'onglet
   *  courant. */
  tab?: string;
  /** Nom de l'écran, affiché dans la pastille de rappel. */
  label: string;
  steps: TourStep[];
};

/** Onglet actif déclaré par la page, lu dans le DOM plutôt que remonté par
 *  React : aucune page n'a ainsi besoin de connaître le contexte d'aide, et
 *  c'est le même mécanisme que les ancres `data-tour`. */
function activeTab(): string | null {
  const el = document.querySelector("[data-tour-tab]");
  return el?.getAttribute("data-tour-tab") || null;
}

/** Trouve l'entrée du registre pour une route et un onglet : d'abord l'entrée
 *  qui cible explicitement cet onglet, sinon celle qui ne cible aucun onglet. */
function findScreen(pathname: string, tab: string | null): ScreenTour | null {
  const onRoute = SCREEN_TOURS.filter((s) => matchPath(s.pattern, pathname));
  if (onRoute.length === 0) return null;
  if (tab) {
    const exact = onRoute.find((s) => s.tab === tab);
    if (exact) return exact;
  }
  return onRoute.find((s) => s.tab === undefined) ?? null;
}

const TOUS: Audience[] = ["club", "skater"];
const CLUB: Audience[] = ["club"];
const SKATER: Audience[] = ["skater"];

/** Étapes communes à tous les écrans : les repères du shell. Elles ouvrent le
 *  mini-parcours du premier écran visité, puis ne sont plus rejouées — d'où
 *  leur présence dans le seul jeu du tableau de bord et de la page patineur,
 *  qui sont les deux points d'entrée possibles. */
const REPERES: TourStep[] = [
  {
    target: "sidebar-nav",
    title: "Le menu de navigation",
    body: "Toutes les sections de l'application sont ici. Le menu se replie avec la flèche en bas pour gagner de la place.",
    chapterId: "premiers-pas",
    audience: CLUB,
  },
  {
    target: "notifications",
    title: "Vos notifications",
    body: "La cloche signale les nouveautés qui vous concernent. La pastille indique le nombre de messages non lus.",
    audience: TOUS,
  },
  {
    target: "help-menu",
    title: "L'aide, à tout moment",
    body: "Ce menu rouvre la documentation et permet de relancer ce tutoriel quand vous le souhaitez.",
    audience: TOUS,
  },
  // « Mon compte » est dédoublé par parcours : une étape par public, chacune
  // renvoyant au chapitre écrit pour lui.
  {
    target: "user-account",
    title: "Votre compte",
    body: "Mot de passe, préférences de notification et déconnexion se trouvent ici.",
    chapterId: "mon-compte",
    audience: SKATER,
  },
  {
    target: "user-account",
    title: "Votre compte",
    body: "Mot de passe, préférences de notification et déconnexion se trouvent ici.",
    chapterId: "mon-compte-club",
    audience: CLUB,
  },
];

export const SCREEN_TOURS: ScreenTour[] = [
  // ── Analyse patineur : trois onglets portés par un `useState`, donc trois
  // écrans distincts pour le tutoriel. La page annonce l'onglet actif via
  // `data-tour-tab` ; sans cela le tutoriel ne se déclencherait que sur
  // l'onglet ouvert à l'arrivée.
  {
    pattern: "/patineurs/:id/analyse",
    tab: "competitions",
    label: "l'onglet Compétitions",
    steps: [
      // Un compte `skater` n'atteint jamais `/` (il y est redirigé) : ses
      // repères de shell s'attachent donc à sa page d'entrée. Un compte
      // « club » les voit sur le tableau de bord.
      {
        target: "sidebar-nav",
        title: "Votre espace",
        body: "Ce menu mène à la page de votre patineur. Si plusieurs patineurs sont rattachés à votre compte, il affiche la liste.",
        chapterId: "bienvenue",
        audience: SKATER,
      },
      ...REPERES.filter(
        (s) => s.target !== "sidebar-nav" && s.audience.includes("skater")
      ),
      {
        target: "analyse-entete",
        title: "La fiche du patineur",
        body: "Nom, club et catégorie du patineur, avec le sélecteur de saison pour changer de période.",
        chapterId: "page-patineur",
        audience: SKATER,
      },
      {
        target: "analyse-entete",
        title: "La fiche du patineur",
        body: "Nom, club et catégorie, avec le sélecteur de saison. Le bouton d'export produit un rapport PDF.",
        chapterId: "patineurs",
        audience: CLUB,
      },
      {
        target: "analyse-evolution",
        title: "L'évolution des scores",
        body: "Chaque point est une compétition. Le sélecteur au-dessus du graphique change ce qui est tracé : score total, segments, note technique ou composantes.",
        chapterId: "comprendre-les-scores-club",
        audience: CLUB,
      },
      {
        target: "analyse-elements",
        title: "Le détail technique",
        body: "Chaque élément réalisé, sa valeur de base et la note d'exécution attribuée par les juges.",
        chapterId: "comprendre-les-scores-club",
        audience: CLUB,
      },
    ],
  },
  {
    pattern: "/patineurs/:id/analyse",
    tab: "training",
    label: "l'onglet Entraînement",
    steps: [
      {
        target: "analyse-training",
        title: "Le suivi d'entraînement",
        body: "Cet onglet rassemble le travail hors compétition. Ses sous-onglets découpent le suivi : Retours (les bilans réguliers de l'entraîneur), Défis (les objectifs en cours), Incidents (blessures et interruptions) et Évolution (les courbes de progression).",
        chapterId: "entrainement",
        audience: CLUB,
      },
      {
        target: "analyse-training",
        title: "Votre suivi d'entraînement",
        body: "Retrouvez ici votre Journal, les Retours de votre entraîneur, vos Défis en cours, les Incidents signalés et vos courbes d'Évolution — un sous-onglet par sujet.",
        chapterId: "page-patineur",
        audience: SKATER,
      },
    ],
  },
  {
    pattern: "/patineurs/:id/analyse",
    tab: "journal",
    label: "l'onglet Journal",
    steps: [
      {
        target: "sidebar-nav",
        title: "Votre espace",
        body: "Ce menu mène à la page de votre patineur. Si plusieurs patineurs sont rattachés à votre compte, il affiche la liste.",
        chapterId: "bienvenue",
        audience: SKATER,
      },
      ...REPERES.filter(
        (s) => s.target !== "sidebar-nav" && s.audience.includes("skater")
      ),
      {
        target: "analyse-journal",
        title: "Votre journal",
        body: "Votre humeur du jour, vos auto-évaluations et le suivi de la semaine se retrouvent ici, à chaque connexion.",
        chapterId: "page-patineur",
        audience: SKATER,
      },
      {
        target: "analyse-autoeval",
        title: "Vos auto-évaluations",
        body: "Notez votre ressenti après chaque séance : ces auto-évaluations aident votre entraîneur à suivre votre progression.",
        chapterId: "page-patineur",
        audience: SKATER,
      },
      {
        target: "analyse-journal",
        title: "Le journal du patineur",
        body: "Le carnet quotidien du patineur : humeur du jour et auto-évaluations après séance. C'est lui qui les remplit ; vous les consultez.",
        chapterId: "entrainement",
        audience: CLUB,
      },
    ],
  },
  {
    pattern: "/patineurs",
    label: "la liste des patineurs",
    steps: [
      {
        target: "patineurs-liste",
        title: "Les patineurs du club",
        body: "La liste de tous les patineurs connus. Un clic sur une ligne ouvre la page d'analyse correspondante.",
        chapterId: "patineurs",
        audience: CLUB,
      },
    ],
  },
  {
    pattern: "/competitions",
    label: "les compétitions",
    steps: [
      {
        target: "competitions-import",
        title: "Importer une compétition",
        body: "Ce bouton ouvre le formulaire d'import : collez-y l'adresse du site de la compétition, l'application récupère les feuilles de notes et en extrait les scores.",
        chapterId: "competitions",
        audience: CLUB,
      },
      {
        target: "competitions-liste",
        title: "Les compétitions importées",
        body: "Chaque compétition peut être ouverte pour voir ses résultats, ou réimportée si le site a été mis à jour.",
        chapterId: "competitions",
        audience: CLUB,
      },
    ],
  },
  {
    pattern: "/club/saison",
    label: "les statistiques du club",
    steps: [
      {
        target: "club-onglets",
        title: "Saison ou compétition",
        body: "Ces onglets basculent entre la vue d'ensemble de la saison et l'analyse d'une compétition précise.",
        chapterId: "statistiques-club",
        audience: CLUB,
      },
      {
        target: "club-contenu",
        title: "Les chiffres du club",
        body: "Participations, scores moyens par catégorie et comparaisons entre patineurs sur la période choisie.",
        chapterId: "statistiques-club",
        audience: CLUB,
      },
    ],
  },
  {
    pattern: "/programme",
    label: "le constructeur de programme",
    steps: [
      {
        target: "programme-contenu",
        title: "Composer un programme",
        body: "Ajoutez les éléments un à un : l'application calcule la note technique attendue et signale les écarts aux règles de la catégorie.",
        chapterId: "programme",
        audience: CLUB,
      },
    ],
  },
  {
    pattern: "/entrainement",
    label: "le suivi d'entraînement",
    steps: [
      {
        target: "entrainement-contenu",
        title: "Le suivi d'entraînement",
        body: "Chaque patineur suivi dispose d'un journal : séances, ressenti, incidents et bilans de l'entraîneur.",
        chapterId: "entrainement",
        audience: CLUB,
      },
    ],
  },
  {
    pattern: "/mes-patineurs",
    label: "mes patineurs",
    steps: [
      {
        target: "mes-patineurs-liste",
        title: "Vos patineurs",
        body: "Les patineurs rattachés à votre compte. Un clic ouvre la page de l'un d'eux.",
        chapterId: "mon-compte",
        audience: SKATER,
      },
      {
        target: "mes-patineurs-ajout",
        title: "Rattacher un patineur",
        body: "Si un second enfant prend une licence, rattachez-le avec son numéro de licence et sa date de naissance.",
        chapterId: "mon-compte",
        audience: SKATER,
      },
    ],
  },
  {
    pattern: "/profil",
    label: "mon compte",
    steps: [
      {
        target: "profil-contenu",
        title: "Votre compte",
        body: "Changez ici votre mot de passe et choisissez si vous souhaitez recevoir des notifications par courriel.",
        chapterId: "mon-compte",
        audience: TOUS,
      },
    ],
  },
  {
    pattern: "/",
    label: "le tableau de bord",
    steps: [
      ...REPERES,
      {
        target: "accueil-indicateurs",
        title: "Les indicateurs de la saison",
        body: "Patineurs actifs, compétitions suivies, programmes notés et podiums, pour la saison sélectionnée.",
        chapterId: "tableau-de-bord",
        audience: CLUB,
      },
      {
        target: "accueil-saison",
        title: "Changer de saison",
        body: "Ce sélecteur rejoue toute la page sur une autre saison. Le bouton voisin exporte un rapport PDF.",
        chapterId: "tableau-de-bord",
        audience: CLUB,
      },
      {
        target: "accueil-scores",
        title: "Les meilleurs scores",
        body: "Les plus hauts totaux de la saison. Un clic mène à la compétition correspondante.",
        chapterId: "tableau-de-bord",
        audience: CLUB,
      },
    ],
  },
];

/** Résout la route courante dans le registre, puis filtre les étapes : par
 *  parcours, et par présence effective de la cible dans le DOM. Ce second
 *  filtre est indispensable — le tableau de bord ne rend ses indicateurs que
 *  lorsque des données existent, donc sur une installation neuve la moitié des
 *  ancres manquent. */
export function screenTourFor(
  pathname: string,
  audience: Audience
): ScreenTour | null {
  const screen = findScreen(pathname, activeTab());
  if (!screen) return null;

  const steps = screen.steps.filter(
    (s) =>
      s.audience.includes(audience) &&
      document.querySelector(`[data-tour="${s.target}"]`) !== null
  );

  if (steps.length === 0) return null;
  return { ...screen, steps };
}

/** Clé de l'écran courant — route et, le cas échéant, onglet actif —
 *  indépendamment de ses étapes : sert à mémoriser qu'un écran a été vu même
 *  quand toutes ses étapes ont été filtrées. Deux onglets d'une même page sont
 *  deux écrans distincts : chacun se déclenche et se mémorise pour lui-même. */
export function screenPatternFor(pathname: string): string | null {
  const screen = findScreen(pathname, activeTab());
  if (!screen) return null;
  return screen.tab ? `${screen.pattern}#${screen.tab}` : screen.pattern;
}
