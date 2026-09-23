# Glossaire SkateLab — notation du patinage artistique (ISU / FFSG)

## Score d'un segment
- **Segment** : partie d'une compétition notée séparément — `SP` programme court,
  `FS` programme libre (d'autres codes existent selon les compétitions : un seul
  segment pour beaucoup de catégories régionales).
- **Score total** (`total_score`) = TES + PCS − déductions.
- **TES** (`technical_score`, Technical Element Score) : somme des éléments exécutés.
- **PCS** (`component_score`, Program Component Score) : composantes artistiques,
  chacune notée par les juges puis multipliée par un facteur (`components` :
  `score`, `factor`, notes des juges).
- **Déductions** (`deductions`) : chutes, dépassement de temps, costume…

## Éléments
- Chaque élément (`elements`) a une **valeur de base** (BV), un **GOE** (Grade of
  Execution, bonus/malus de qualité, de −5 à +5 par juge, converti en points) et un
  score final = BV + GOE.
- Codes usuels : sauts `T` (boucle piquée), `S` (salchow), `Lo` (boucle),
  `F` (flip), `Lz` (lutz), `A` (axel), préfixés du nombre de rotations (`2A`, `3Lz`) ;
  combinaisons `3T+2T` ; pirouettes (`USp`, `CSp`, `LSp`, `SSp`, `CCoSp`…, suffixe de
  niveau `B`/`1`–`4`) ; pas `StSq`, chorégraphie `ChSq`.
- Marqueurs d'exécution : `<` sous-rotation, `<<` déclassé, `q` quart, `e` carre
  incorrecte, `!` carre incertaine, `x` bonus de seconde moitié, `*` élément invalide.

## Catégories et résultats
- **Catégorie** (`category`) : niveau + âge + genre, par ex. « Régional 2 Minime Dame ».
  Champs séparés : `skating_level`, `age_group`, `gender`.
- **Résultat par catégorie** (`category-results`) : classement final
  (`overall_rank`), total combiné des segments (`combined_total`), rangs SP/FS.
- **Saison** : `AAAA-AAAA` (septembre → juin), par ex. `2025-2026`.
- **France Clubs** : compétition par équipes ; `team-scores` donne les points
  d'équipe calculés à partir des médianes par catégorie.

## Conseils d'analyse
- Comparez des scores **à catégorie égale** : les barèmes et programmes imposés
  diffèrent d'un niveau à l'autre.
- Une progression se lit sur la saison (`get_skater_seasons`, `get_skater_scores`
  avec `season`) et élément par élément (`get_skater_elements`).
