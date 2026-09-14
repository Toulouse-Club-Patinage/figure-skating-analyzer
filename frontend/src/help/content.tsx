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

function TabBarFigure({ tabs, active }: { tabs: string[]; active: string }) {
  return (
    <div className="flex gap-0">
      {tabs.map((t) => (
        <div
          key={t}
          className={`px-4 py-2 text-sm font-semibold border-b-2 ${
            t === active
              ? "text-primary border-primary"
              : "text-on-surface-variant border-transparent"
          }`}
        >
          {t}
        </div>
      ))}
    </div>
  );
}

/** Courbe fictive : cinq compétitions, progression irrégulière mais orientée à
 *  la hausse — de quoi montrer comment se lit le graphique, pas un cas réel. */
function EvolutionFigure() {
  const pts = [
    { x: 10, y: 74 },
    { x: 70, y: 58 },
    { x: 130, y: 62 },
    { x: 190, y: 38 },
    { x: 250, y: 24 },
  ];
  const path = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x} ${p.y}`).join(" ");
  return (
    <svg viewBox="0 0 270 100" className="w-full h-24">
      <line x1="10" y1="90" x2="260" y2="90" stroke="#c1c7ce" strokeWidth="1" />
      <path d={path} fill="none" stroke="#2e6385" strokeWidth="2.5" />
      {pts.map((p) => (
        <circle key={p.x} cx={p.x} cy={p.y} r="3.5" fill="#2e6385" />
      ))}
    </svg>
  );
}

function KpiFigure() {
  const kpis = [
    { icon: "people", value: "34", label: "Patineurs actifs" },
    { icon: "emoji_events", value: "12", label: "Compétitions" },
    { icon: "military_tech", value: "7", label: "Podiums" },
  ];
  return (
    <div className="grid grid-cols-3 gap-2">
      {kpis.map((k) => (
        <div key={k.label} className="bg-surface-container-lowest rounded-lg p-3 shadow-sm">
          <span className="material-symbols-outlined text-primary text-base">
            {k.icon}
          </span>
          <p className="text-xl font-bold text-on-surface font-mono leading-tight">
            {k.value}
          </p>
          <p className="text-[10px] text-on-surface-variant">{k.label}</p>
        </div>
      ))}
    </div>
  );
}

function JournalFigure() {
  const days = [
    { d: "Lun", mood: "sentiment_satisfied" },
    { d: "Mar", mood: "sentiment_neutral" },
    { d: "Mer", mood: "sentiment_satisfied" },
    { d: "Jeu", mood: "sentiment_very_satisfied" },
    { d: "Ven", mood: "sentiment_dissatisfied" },
  ];
  return (
    <div className="flex gap-3">
      {days.map((x) => (
        <div key={x.d} className="text-center">
          <p className="text-[10px] text-on-surface-variant mb-1">{x.d}</p>
          <span className="material-symbols-outlined text-primary text-xl">
            {x.mood}
          </span>
        </div>
      ))}
    </div>
  );
}

const CLUB: Audience[] = ["club"];
const SKATER: Audience[] = ["skater"];
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
          l'application, avec un champ de recherche et un bouton pour élargir la
          liste aux autres clubs. Un clic sur une ligne ouvre la page d'analyse.
        </p>

        <h3 className="font-headline font-bold text-on-surface text-sm mt-4 mb-2">
          L'en-tête
        </h3>
        <p className="text-sm text-on-surface-variant mb-3">
          Le bandeau coloré porte le nom du patineur, son club, son meilleur
          score et son nombre de compétitions. À droite, le sélecteur de saison
          rejoue toute la page sur une autre période, et le bouton voisin
          exporte un rapport PDF du patineur.
        </p>

        <h3 className="font-headline font-bold text-on-surface text-sm mt-4 mb-2">
          Les onglets
        </h3>
        <p className="text-sm text-on-surface-variant mb-3">
          Quand le suivi d'entraînement est activé, la page se divise en
          onglets. <strong>Compétitions</strong> rassemble les résultats,{" "}
          <strong>Entraînement</strong> le travail hors compétition. Chaque
          onglet a son propre contenu : pensez à en changer pour voir le reste.
        </p>
        <Figure caption="La barre d'onglets de la page d'analyse, ici sur Compétitions.">
          <TabBarFigure tabs={["Compétitions", "Entraînement"]} active="Compétitions" />
        </Figure>

        <h3 className="font-headline font-bold text-on-surface text-sm mt-4 mb-2">
          L'évolution des scores
        </h3>
        <p className="text-sm text-on-surface-variant mb-3">
          Chaque point du graphique est une compétition, dans l'ordre
          chronologique. Le menu au-dessus change ce que la courbe trace :
        </p>
        <ul className="text-sm text-on-surface-variant mb-3 space-y-1.5 pl-1">
          <li>
            <strong>Résultat</strong> — le score total obtenu à chaque
            compétition.
          </li>
          <li>
            <strong>Segments</strong> — programme court et programme libre
            séparés, pour voir lequel progresse.
          </li>
          <li>
            <strong>TES</strong> — la seule note technique, sans la
            présentation.
          </li>
          <li>
            <strong>PCS</strong> — les composantes de programme, avec un filtre
            court / libre.
          </li>
        </ul>
        <Figure caption="Chaque point est une compétition ; la courbe suit l'ordre chronologique.">
          <EvolutionFigure />
        </Figure>

        <h3 className="font-headline font-bold text-on-surface text-sm mt-4 mb-2">
          Le détail technique
        </h3>
        <p className="text-sm text-on-surface-variant mb-3">
          Sous le graphique, chaque élément réalisé est listé avec sa valeur de
          base et la note d'exécution des juges. Un tableau complémentaire
          regroupe les éléments par famille (sauts, pirouettes, séquences) et
          un graphique montre l'évolution de la valeur de base totale.
        </p>
        <Figure caption="Extrait du détail technique : note de base, GOE, et total par élément.">
          <ScoreRowFigure />
        </Figure>
        <p className="text-sm text-on-surface-variant mb-3">
          Un clic sur une compétition de la liste ouvre sa feuille de notes
          complète, juge par juge.
        </p>
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
      <>
        <p className="text-sm text-on-surface-variant mb-3">
          La section <strong>Club</strong> regarde les résultats à l'échelle du
          club plutôt que patineur par patineur. Deux onglets, chacun avec sa
          propre page.
        </p>
        <Figure caption="Les deux onglets de la section Club.">
          <TabBarFigure tabs={["Saison", "Compétition"]} active="Saison" />
        </Figure>

        <h3 className="font-headline font-bold text-on-surface text-sm mt-4 mb-2">
          L'onglet Saison
        </h3>
        <p className="text-sm text-on-surface-variant mb-3">
          Une vue d'ensemble de la saison entière, en trois blocs :
        </p>
        <ul className="text-sm text-on-surface-variant mb-3 space-y-1.5 pl-1">
          <li>
            <strong>Progression</strong> — l'évolution des scores des patineurs
            du club au fil de la saison.
          </li>
          <li>
            <strong>Comparaison</strong> — un tableau qui met les patineurs
            côte à côte sur les mêmes indicateurs.
          </li>
          <li>
            <strong>Maîtrise des éléments</strong> — quels éléments sont
            réussis et lesquels coûtent des points, avec un taux de réussite
            des sauts.
          </li>
        </ul>

        <h3 className="font-headline font-bold text-on-surface text-sm mt-4 mb-2">
          L'onglet Compétition
        </h3>
        <p className="text-sm text-on-surface-variant mb-3">
          La même analyse, resserrée sur une compétition que vous choisissez :
          le <strong>classement Club Challenge</strong>, les{" "}
          <strong>podiums du club</strong>, et les{" "}
          <strong>résultats détaillés</strong> de chaque patineur engagé.
        </p>
        <p className="text-sm text-on-surface-variant mb-3">
          C'est la page à ouvrir au retour d'une compétition pour voir ce que le
          club y a fait.
        </p>
      </>
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
      <>
        <p className="text-sm text-on-surface-variant mb-3">
          Le suivi d'entraînement s'active dans l'administration. Une fois en
          place, il ajoute une section <strong>Entraînement</strong> au menu et
          un onglet du même nom sur la page de chaque patineur suivi.
        </p>

        <h3 className="font-headline font-bold text-on-surface text-sm mt-4 mb-2">
          La section Entraînement
        </h3>
        <p className="text-sm text-on-surface-variant mb-3">
          Elle liste les patineurs suivis et donne l'humeur agrégée de la
          semaine. Un clic sur un patineur ouvre son suivi détaillé.
        </p>

        <h3 className="font-headline font-bold text-on-surface text-sm mt-4 mb-2">
          Les quatre sous-onglets
        </h3>
        <ul className="text-sm text-on-surface-variant mb-3 space-y-1.5 pl-1">
          <li>
            <strong>Retours</strong> — les bilans hebdomadaires de
            l'entraîneur, notés sur l'engagement, la progression et l'attitude.
          </li>
          <li>
            <strong>Défis</strong> — les objectifs fixés au patineur, avec leur
            échéance. Passée la date, un défi sort des défis actifs.
          </li>
          <li>
            <strong>Incidents</strong> — blessures et interruptions, pour
            garder trace de ce qui explique un creux.
          </li>
          <li>
            <strong>Évolution</strong> — les courbes de progression sur la
            période suivie.
          </li>
        </ul>
        <Figure caption="Les sous-onglets du suivi d'entraînement, ici sur Retours.">
          <TabBarFigure
            tabs={["Retours", "Défis", "Incidents", "Évolution"]}
            active="Retours"
          />
        </Figure>

        <h3 className="font-headline font-bold text-on-surface text-sm mt-4 mb-2">
          Le journal du patineur
        </h3>
        <p className="text-sm text-on-surface-variant mb-3">
          Le patineur dispose en plus d'un <strong>Journal</strong> : il y note
          son humeur du jour et remplit une auto-évaluation après ses séances.
          C'est lui qui l'alimente — vous le consultez. Ce sous-onglet
          n'apparaît que sur les comptes patineur.
        </p>
        <Figure caption="L'humeur quotidienne relevée par le patineur au fil de la semaine.">
          <JournalFigure />
        </Figure>
      </>
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
  {
    // Version club, volontairement brève : le rattachement d'un patineur par
    // numéro de licence n'existe que pour les comptes patineur.
    id: "mon-compte-club",
    title: "Mon compte",
    icon: "account_circle",
    audience: CLUB,
    body: () => (
      <p className="text-sm text-on-surface-variant mb-3">
        Votre compte est accessible en bas du menu de gauche. Vous pouvez y
        changer votre mot de passe et choisir si vous souhaitez recevoir des
        notifications par courriel. La déconnexion se trouve juste à côté.
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
    // Deux chapitres pour le même sujet : un parent découvre la notation, un
    // entraîneur la connaît et cherche comment l'application la restitue.
    id: "comprendre-les-scores",
    title: "Comprendre les scores",
    icon: "calculate",
    audience: SKATER,
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
    id: "comprendre-les-scores-club",
    title: "Comprendre les scores",
    icon: "calculate",
    audience: CLUB,
    body: () => (
      <>
        <p className="text-sm text-on-surface-variant mb-3">
          Ce chapitre ne réexplique pas la notation ISU, que vous connaissez :
          il décrit ce que l'application en fait, et où le retrouver.
        </p>

        <h3 className="font-headline font-bold text-on-surface text-sm mt-4 mb-2">
          Ce qui est extrait des feuilles de notes
        </h3>
        <p className="text-sm text-on-surface-variant mb-3">
          Pour chaque programme, l'import retient le score total, la note
          technique et les composantes, puis le détail élément par élément :
          code de l'élément, valeur de base, GOE, total, et les notes
          individuelles des juges lorsqu'elles figurent au protocole.
        </p>
        <Figure caption="Le détail conservé pour chaque élément d'un programme.">
          <ScoreRowFigure />
        </Figure>

        <h3 className="font-headline font-bold text-on-surface text-sm mt-4 mb-2">
          Comment les scores sont agrégés
        </h3>
        <ul className="text-sm text-on-surface-variant mb-3 space-y-1.5 pl-1">
          <li>
            <strong>Par patineur</strong> — les compétitions d'une saison
            forment les courbes d'évolution, déclinables en score total,
            segments, TES ou PCS.
          </li>
          <li>
            <strong>Par famille d'éléments</strong> — sauts, pirouettes et
            séquences sont regroupés pour dégager les points forts et les
            éléments coûteux.
          </li>
          <li>
            <strong>Par club</strong> — la section Club compare les patineurs
            entre eux sur une saison ou sur une compétition.
          </li>
        </ul>

        <h3 className="font-headline font-bold text-on-surface text-sm mt-4 mb-2">
          Les limites à connaître
        </h3>
        <p className="text-sm text-on-surface-variant mb-3">
          L'application ne recalcule rien : elle restitue ce que le protocole
          publie. Si une feuille de notes est incomplète ou publiée dans un
          format inhabituel, le détail peut manquer alors que le score total
          est correct. Le journal d'import signale ce qui n'a pas pu être lu.
        </p>
      </>
    ),
  },
  {
    id: "mon-compte",
    title: "Mon compte et mes patineurs",
    icon: "account_circle",
    audience: SKATER,
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
