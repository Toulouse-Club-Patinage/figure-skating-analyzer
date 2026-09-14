import type { ReactNode } from "react";

export type Audience = "club" | "skater";

export type Chapter = {
  id: string;
  title: string;
  icon: string;
  audience: Audience[];
  /** Affiche un badge « Administrateur » : le chapitre décrit un écran
   *  réservé aux administrateurs. */
  adminOnly?: boolean;
  body: () => ReactNode;
};

/** Les illustrations rejouent l'interface avec des données fictives plutôt que
 *  d'embarquer des captures : aucune donnée de patineur réel n'entre dans la
 *  documentation, et le rendu ne périme pas au premier ajustement de l'UI.
 *  Elles sont décoratives — la légende porte l'information. */
function Figure({ children, caption }: { children: ReactNode; caption: string }) {
  return (
    <figure className="my-4">
      <div
        aria-hidden="true"
        className="bg-surface-container rounded-xl p-3 overflow-x-auto"
      >
        {children}
      </div>
      <figcaption className="text-xs text-on-surface-variant mt-2">
        {caption}
      </figcaption>
    </figure>
  );
}

function SidebarFigure() {
  const items = [
    { icon: "dashboard", label: "TABLEAU DE BORD", active: true },
    { icon: "people", label: "PATINEURS", active: false },
    { icon: "emoji_events", label: "COMPÉTITIONS", active: false },
    { icon: "bar_chart", label: "CLUB", active: false },
  ];
  return (
    <div className="bg-surface-container-low rounded-lg py-2 w-56">
      {items.map((it) => (
        <div
          key={it.label}
          className={
            it.active
              ? "bg-surface-container-lowest text-primary shadow-sm rounded-lg mx-2 my-0.5 px-3 py-2 flex items-center gap-2 font-bold"
              : "text-on-surface-variant rounded-lg mx-2 my-0.5 px-3 py-2 flex items-center gap-2"
          }
        >
          <span className="material-symbols-outlined text-lg">{it.icon}</span>
          <span className="text-[10px] font-bold uppercase tracking-wider">
            {it.label}
          </span>
        </div>
      ))}
    </div>
  );
}

function ScoreRowFigure() {
  const rows = [
    { el: "2A", base: "3.30", goe: "+0.66", total: "3.96" },
    { el: "3T", base: "4.20", goe: "-0.84", total: "3.36" },
    { el: "FCSp3", base: "2.80", goe: "+0.28", total: "3.08" },
  ];
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-on-surface-variant text-left">
          <th className="py-1 font-medium">Élément</th>
          <th className="py-1 font-medium">Base</th>
          <th className="py-1 font-medium">GOE</th>
          <th className="py-1 font-medium">Total</th>
        </tr>
      </thead>
      <tbody className="text-on-surface">
        {rows.map((r) => (
          <tr key={r.el} className="bg-surface-container-lowest">
            <td className="py-1.5 px-1 font-mono">{r.el}</td>
            <td className="py-1.5 px-1 font-mono">{r.base}</td>
            <td
              className={`py-1.5 px-1 font-mono ${
                r.goe.startsWith("-") ? "text-error" : "text-primary"
              }`}
            >
              {r.goe}
            </td>
            <td className="py-1.5 px-1 font-mono font-bold">{r.total}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const CLUB: Audience[] = ["club"];
const TOUS: Audience[] = ["club", "skater"];

const CHAPITRES_CLUB: Chapter[] = [
  {
    id: "premiers-pas",
    title: "Premiers pas",
    icon: "flag",
    audience: CLUB,
    body: () => (
      <>
        <p className="text-sm text-on-surface-variant mb-3">
          L'application rassemble les résultats de compétition de vos patineurs
          et les met en perspective : évolution des scores, détail des éléments
          techniques, comparaison au sein du club.
        </p>
        <p className="text-sm text-on-surface-variant mb-3">
          Le menu de gauche donne accès aux grandes sections. La barre du haut
          affiche le titre de la page courante, vos notifications et ce menu
          d'aide.
        </p>
        <Figure caption="Le menu de navigation, ici sur le tableau de bord.">
          <SidebarFigure />
        </Figure>
      </>
    ),
  },
  {
    id: "tableau-de-bord",
    title: "Le tableau de bord",
    icon: "dashboard",
    audience: CLUB,
    body: () => (
      <>
        <p className="text-sm text-on-surface-variant mb-3">
          Le tableau de bord est la page d'accueil. Il résume la saison : nombre
          de patineurs actifs, compétitions suivies, programmes notés et
          podiums.
        </p>
        <p className="text-sm text-on-surface-variant mb-3">
          En dessous, les meilleurs scores de la saison, les progressions les
          plus fortes, les médailles et les compétitions récentes. Le sélecteur
          en haut à droite change de saison, et le bouton voisin exporte un
          rapport de saison en PDF.
        </p>
      </>
    ),
  },
  {
    id: "patineurs",
    title: "Les patineurs et leur analyse",
    icon: "people",
    audience: CLUB,
    body: () => (
      <>
        <p className="text-sm text-on-surface-variant mb-3">
          La section <strong>Patineurs</strong> liste les patineurs connus de
          l'application. Un clic sur l'un d'eux ouvre sa page d'analyse.
        </p>
        <h3 className="font-headline font-bold text-on-surface text-sm mt-4 mb-2">
          La page d'analyse
        </h3>
        <p className="text-sm text-on-surface-variant mb-3">
          Elle réunit l'évolution des scores au fil de la saison, la répartition
          des composantes de programme, et le détail des éléments techniques
          avec leur note d'exécution.
        </p>
        <Figure caption="Extrait du détail technique : note de base, GOE, et total par élément.">
          <ScoreRowFigure />
        </Figure>
      </>
    ),
  },
  {
    id: "competitions",
    title: "Les compétitions et l'import",
    icon: "emoji_events",
    audience: CLUB,
    adminOnly: true,
    body: () => (
      <>
        <p className="text-sm text-on-surface-variant mb-3">
          Les résultats sont importés depuis l'adresse du site de la
          compétition. L'application récupère les feuilles de notes et en
          extrait les scores.
        </p>
        <p className="text-sm text-on-surface-variant mb-3">
          Un import peut être relancé si la compétition a été mise à jour depuis
          la dernière récupération. Le journal d'import indique ce qui a été lu
          et ce qui a posé problème.
        </p>
      </>
    ),
  },
  {
    id: "statistiques-club",
    title: "Les statistiques du club",
    icon: "bar_chart",
    audience: CLUB,
    body: () => (
      <p className="text-sm text-on-surface-variant mb-3">
        La section <strong>Club</strong> agrège les résultats sur la saison ou
        sur une compétition donnée : nombre de participations, scores moyens par
        catégorie, et comparaison entre patineurs.
      </p>
    ),
  },
  {
    id: "programme",
    title: "Le constructeur de programme",
    icon: "sports_score",
    audience: CLUB,
    body: () => (
      <p className="text-sm text-on-surface-variant mb-3">
        Le constructeur permet de composer un programme élément par élément et
        d'en estimer la note technique. Les règles de la catégorie choisie sont
        vérifiées au fur et à mesure et les écarts sont signalés.
      </p>
    ),
  },
  {
    id: "entrainement",
    title: "Le suivi d'entraînement",
    icon: "fitness_center",
    audience: CLUB,
    body: () => (
      <p className="text-sm text-on-surface-variant mb-3">
        Lorsque le suivi d'entraînement est activé, chaque patineur dispose d'un
        journal : séances, ressenti, incidents, et bilans réguliers rédigés par
        l'entraîneur.
      </p>
    ),
  },
  {
    id: "administration",
    title: "Administration",
    icon: "settings",
    audience: CLUB,
    adminOnly: true,
    body: () => (
      <p className="text-sm text-on-surface-variant mb-3">
        L'administration regroupe la gestion des comptes, les réglages du club,
        les demandes de création de compte, et le suivi des tâches d'import.
      </p>
    ),
  },
];

const CHAPITRES_PATINEUR: Chapter[] = [
  {
    id: "bienvenue",
    title: "Bienvenue",
    icon: "waving_hand",
    audience: ["skater"],
    body: () => (
      <>
        <p className="text-sm text-on-surface-variant mb-3">
          Cet espace rassemble les résultats de compétition de votre patineur.
          Vous y retrouvez ses notes, leur évolution, et le détail de chaque
          programme.
        </p>
        <p className="text-sm text-on-surface-variant mb-3">
          Le menu de gauche mène directement à sa page. Si plusieurs patineurs
          sont rattachés à votre compte, il affiche la liste.
        </p>
      </>
    ),
  },
  {
    id: "page-patineur",
    title: "La page de mon patineur",
    icon: "ice_skating",
    audience: ["skater"],
    body: () => (
      <p className="text-sm text-on-surface-variant mb-3">
        La page réunit les compétitions disputées, le score obtenu à chacune, et
        le détail de chaque programme. Les graphiques montrent l'évolution au
        fil de la saison.
      </p>
    ),
  },
  {
    id: "comprendre-les-scores",
    title: "Comprendre les scores",
    icon: "calculate",
    audience: TOUS,
    body: () => (
      <>
        <p className="text-sm text-on-surface-variant mb-3">
          Une note se compose de deux parties : la{" "}
          <strong>note technique</strong>, qui additionne la valeur des éléments
          réalisés, et les <strong>composantes de programme</strong>, qui
          évaluent la présentation d'ensemble.
        </p>
        <h3 className="font-headline font-bold text-on-surface text-sm mt-4 mb-2">
          La note technique
        </h3>
        <p className="text-sm text-on-surface-variant mb-3">
          Chaque élément a une valeur de base. Les juges y ajoutent ou en
          retranchent une note d'exécution, le <strong>GOE</strong>, selon la
          qualité de réalisation.
        </p>
        <Figure caption="Un GOE positif s'ajoute à la valeur de base, un GOE négatif s'en retranche.">
          <ScoreRowFigure />
        </Figure>
        <h3 className="font-headline font-bold text-on-surface text-sm mt-4 mb-2">
          Les composantes
        </h3>
        <p className="text-sm text-on-surface-variant mb-3">
          Elles notent le patinage lui-même : qualité des carres, présentation,
          interprétation de la musique. Elles varient plus lentement que la note
          technique d'une compétition à l'autre.
        </p>
      </>
    ),
  },
  {
    id: "mon-compte",
    title: "Mon compte et mes patineurs",
    icon: "account_circle",
    audience: TOUS,
    body: () => (
      <>
        <p className="text-sm text-on-surface-variant mb-3">
          Votre compte est accessible en bas du menu de gauche. Vous pouvez y
          changer votre mot de passe et vos préférences de notification.
        </p>
        <p className="text-sm text-on-surface-variant mb-3">
          Si un second enfant prend une licence en cours de saison, vous pouvez
          le rattacher à votre compte depuis la page{" "}
          <strong>Mes patineurs</strong>, avec son numéro de licence et sa date
          de naissance.
        </p>
      </>
    ),
  },
];

export const CHAPTERS: Chapter[] = [...CHAPITRES_CLUB, ...CHAPITRES_PATINEUR];

export function chaptersFor(audience: Audience): Chapter[] {
  return CHAPTERS.filter((c) => c.audience.includes(audience));
}
