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
  /** Nom de l'écran, affiché dans la pastille de rappel. */
  label: string;
  steps: TourStep[];
};

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
  {
    target: "user-account",
    title: "Votre compte",
    body: "Mot de passe, préférences de notification et déconnexion se trouvent ici.",
    chapterId: "mon-compte",
    audience: TOUS,
  },
];

export const SCREEN_TOURS: ScreenTour[] = [
  {
    pattern: "/patineurs/:id/analyse",
    label: "l'analyse d'un patineur",
    steps: [
      // Un compte `skater` n'atteint jamais `/` (il y est redirigé) : ses
      // repères de shell s'attachent donc à sa page d'entrée, qui est
      // celle-ci. Un compte « club » les voit sur le tableau de bord.
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
        body: "Chaque point est une compétition. La courbe montre la progression au fil de la saison.",
        chapterId: "comprendre-les-scores",
        audience: CLUB,
      },
      {
        target: "analyse-elements",
        title: "Le détail technique",
        body: "Chaque élément réalisé, sa valeur de base et la note d'exécution attribuée par les juges.",
        chapterId: "comprendre-les-scores",
        audience: CLUB,
      },
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
        body: "Collez ici l'adresse du site de la compétition : l'application récupère les feuilles de notes et en extrait les scores.",
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
  const screen = SCREEN_TOURS.find((s) => matchPath(s.pattern, pathname));
  if (!screen) return null;

  const steps = screen.steps.filter(
    (s) =>
      s.audience.includes(audience) &&
      document.querySelector(`[data-tour="${s.target}"]`) !== null
  );

  if (steps.length === 0) return null;
  return { ...screen, steps };
}

/** Le motif de route de l'écran courant, indépendamment de ses étapes : sert à
 *  mémoriser qu'un écran a été vu même quand toutes ses étapes ont été
 *  filtrées. */
export function screenPatternFor(pathname: string): string | null {
  return SCREEN_TOURS.find((s) => matchPath(s.pattern, pathname))?.pattern ?? null;
}
