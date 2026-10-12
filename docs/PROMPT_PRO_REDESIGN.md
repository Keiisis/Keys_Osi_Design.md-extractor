# PROMPT_PRO.md — refonte UI/UX de la popup Keys_Osi

> Prompt maître au format PROMPT PRO (anatomie Keys_Osi en 13 blocs). Il pilote la refonte de `popup/popup.css` et les retouches de `popup/popup.html` / `popup/views.js`. Toute valeur ci-dessous est une règle, pas une suggestion.

## 1. Mission

Refaire la popup Chrome de Keys_Osi (560 px de large, 600 px de haut visibles, défilement vertical) en **instrument de mesure haut de gamme** : un clavier de précision posé sur un établi sombre.

- **Idée centrale** : les touches. Les actions sont des *keycaps* tactiles. Le format actif porte un témoin lumineux, comme le voyant Verr. Maj.
- **Matériau** : le verre est réservé à la **barre d'onglets flottante**. Le contenu défile dessous, ce qui donne au flou une raison d'exister. Toutes les autres surfaces sont pleines, avec une élévation par la luminosité.
- **Couleur** : une couleur de repère par vue. Elle colore le témoin, le pouce du sélecteur, le bouton principal, l'anneau de focus et la teinte du verre. Elle couvre moins de 5 % de chaque écran.
- **Mouvement** : grand titre façon Apple. Au défilement, le nom de marque glisse et s'efface plus lentement que la page (parallaxe). Le domaine du site analysé, géant et estompé, glisse encore plus lentement derrière lui.

Stack : HTML/CSS de l'extension, sans framework ni dépendance. Polices locales déjà présentes dans `assets/fonts/`.

## 2. Polices

- **Display** : Instrument Serif 400, romain uniquement. Utilisé pour le titre de marque (44 px), les titres de dépliants (21 px) et les grands chiffres (22 px).
- **Texte** : Geist, variable 300–700. Interface à 13 px et 400 ; libellés de touches en 500 ; actions principales en 600.
- **Données** : Geist Mono 400–600. Hex, routes, compteurs, noms de formats. Chiffres tabulaires (`font-variant-numeric: tabular-nums`).
- **Interdits** : italique dans un titre, texte en dégradé, Inter, Roboto, system-ui en display.

## 3. Système de couleur

OKLCH, tokens nommés uniquement. Les neutres sont tous teintés.

| Rôle | Nuit | Jour |
| --- | --- | --- |
| `--color-paper` (établi) | `oklch(15.5% 0.012 65)` | `oklch(97% 0.008 80)` |
| `--color-paper-2` (surface) | `oklch(19.5% 0.013 65)` | `oklch(99.2% 0.004 80)` |
| `--color-paper-3` (surface relevée) | `oklch(24% 0.014 65)` | `oklch(93.5% 0.01 80)` |
| `--color-key` (dessus de touche) | `oklch(27% 0.012 65)` | `oklch(99.5% 0.003 80)` |
| `--color-key-edge` (flanc de touche) | `oklch(11% 0.01 65)` | `oklch(82% 0.012 80)` |
| `--color-rule` | `oklch(100% 0 0 / 0.09)` | `oklch(25% 0.02 60 / 0.12)` |
| `--color-ink` | `oklch(95% 0.008 80)` | `oklch(19% 0.015 60)` |
| `--color-ink-2` | `oklch(80% 0.01 75)` | `oklch(36% 0.015 60)` |
| `--color-muted` | `oklch(66% 0.012 70)` | `oklch(50% 0.014 60)` |

Une couleur de repère par vue (`body[data-view]` → `--view`). En mode jour, chaque teinte est assombrie d'environ 10 points de L pour garder le contraste :

- Design : vermillon `oklch(68% 0.19 33)`
- Site : cobalt `oklch(68% 0.15 255)`
- Assets : jade `oklch(74% 0.13 162)`
- 3D : ambre `oklch(80% 0.15 78)`
- Moodboard : orchidée `oklch(72% 0.15 335)`

`--view-ink` est l'encre posée sur la couleur de repère (encre sombre, contraste ≥ 4,5:1). Danger : `oklch(68% 0.18 25)`. Succès : `oklch(76% 0.14 155)`.

## 4. Surfaces et CSS utilitaire

- **Verre** (barre d'onglets uniquement) :
  - `background: color-mix(in oklch, var(--color-paper) 64%, transparent)` ;
  - `backdrop-filter: blur(22px) saturate(170%)` ;
  - liseré haut `inset 0 1px 0 oklch(100% 0 0 / 0.07)` et liseré bas `var(--color-rule)` ;
  - teinte : un voile de `--view` à 10 % de chaque côté.
- **Touche (keycap)** :
  - dessus `--color-key` éclairé d'un léger dégradé vertical, comme un ombrage physique ;
  - bordure de 1 px `--color-rule` ;
  - ombre portée `0 2px 0 var(--color-key-edge), 0 6px 14px -8px` noir à 60 % ;
  - à l'appui : `translateY(2px)` et ombre réduite à `0 0 0`.
- **Témoin** : point de 6 px, couleur `--view`, halo `0 0 8px` de la même couleur. N'apparaît que sur l'élément actif.
- **Carte** : `--color-paper-2`, bordure de 1 px `--color-rule`, rayon de 14 px. Aucune ombre en mode nuit (l'élévation passe par la luminosité). Au survol, la bordure passe à `--color-rule-2`. Aucune mise à l'échelle.
- **Interdits** :
  - fond « aurora » ou taches de couleur floues ;
  - carte dans une carte ;
  - liseré latéral épais ;
  - `transition: all` ;
  - plusieurs effets de survol simultanés.

## 5. Règles de mise en page

- Marges latérales de 18 px. Échelle d'espacement 4 pt : `--space-2xs` 4, `-xs` 8, `-sm` 12, `-md` 16, `-lg` 20, `-xl` 28, `-2xl` 40.
- Rayons : `--radius-sm` 8, `-md` 12, `-lg` 16, `-pill` 999.
- Couches : contenu 0, barre d'onglets collante 10, carte Lens hors popup.
- Pistes de grille en `minmax(0, 1fr)`, jamais `1fr` nu. `overflow-x: clip` sur `html` et `body`.

## 6. Sections (ordre du DOM)

1. **En-tête de marque (grand titre)**
   - Médaillon du logo (40 px, anneau métallique fixe, sans rotation) ;
   - « Keys_Osi » en Instrument Serif 44 px, encre pleine ;
   - ligne mono : `design · structure · assets · 3D` ;
   - à droite, empilés : puce du site analysé (point vert vivant), touche **Lens**, version.
   - Derrière, le domaine du site actif en display à 120 px, encre à 6 %, en parallaxe.
2. **Barre d'onglets en verre (collante)** : sélecteur segmenté de 5 touches à plat.
   - Un pouce (`--view`, 14 % d'opacité, bordure `--view`) glisse sous l'onglet actif par `transform: translateX(calc(var(--i) * 100%))` ;
   - le libellé actif est en `--color-ink`, les autres en `--color-muted` ;
   - pastille de compte mono.
3. **Vue Design**
   - **Barre de source** (si Figma) : capsule `--view` à 12 %.
   - **Formats** : rangée de keycaps de largeur naturelle (flex-wrap, sans grille égale). Chaque touche porte le nom du format en mono 600 et un indice en 11 px. La touche active a son témoin. PROMPT PRO est une touche large (fin de rangée).
   - **Panneau PROMPT PRO** : surface pleine.
     - **Brand Kit** : zone de dépôt en tirets fins, *chips* des couleurs du logo, échelle primaire en ruban de 11 cases, rôles en mini-swatches, 3 paires de polices en spécimens.
     - **Contexte** : interrupteurs.
     - **Moteur IA** : champs.
     - **Bouton principal** : keycap pleine `--view` avec encre `--view-ink`.
   - **Mesure de progression** : 4 segments.
   - **Document** : barre d'outils (icônes 30 px), zone mono 11 px, interligne 1,65, puis barre d'avis « Ce résultat est-il juste ? » avec deux touches plates.
   - **Dépliants** : titre Instrument Serif 21 px, méta mono en capitales à droite, chevron en filet. Ordre : Cloner, Comparer, Figma, Accessibilité, Mémoire, Kits, Agent.
4. **Vue Site**
   - Titre de l'origine en display.
   - Options en ligne.
   - Keycap principale « Scanner tout le site ».
   - Barre de progression fine (`--view`).
   - Statistiques en rangée de chiffres display (pas de cartes).
   - Liste des pages : route mono, étiquette de type, objectif en 12 px.
   - Dépliant Décodage technique.
5. **Vue Assets** : filtres en puces, grille 3 colonnes de vignettes sur damier, actions en mini-touches.
6. **Vue 3D** : cartes modèle avec aperçu WebGL sur une scène sombre neutre. Inspecteur réseau en lignes mono.
7. **Vue Moodboard** : maçonnerie à 2 colonnes, épingles sans bordure épaisse, légende mono, bouton × au focus ou au survol.
8. **Colophon** : filet, puis « Tout reste sur ta machine, sauf les appels que tu déclenches : IA, Figma, catalogue de polices. »

## 7. Système de mouvement

Une seule entrée orchestrée : changement de vue en fondu de 180 ms. Tout le reste est réactif.

- **Parallaxe** (scroll-driven, `animation-timeline: scroll(root)`, sous `@supports` et `prefers-reduced-motion: no-preference`) :
  - titre de marque : 0 → 140 px de défilement, `translateY(0 → 28px)`, `scale(1 → 0.94)`, `opacity(1 → 0.35)` ;
  - spécimen du domaine : 0 → 300 px, `translateY(0 → 72px)` ;
  - verre de la barre : 60 → 140 px, apparition de l'ombre et du liseré.
- **Pouce du sélecteur** : `transform` 320 ms, `--ease-out: cubic-bezier(0.16, 1, 0.3, 1)`.
- **Touches** : `transform` 90 ms à l'appui, `box-shadow` 140 ms.
- **Mouvement réduit** : pas de parallaxe ni de glissement, fondus ≤ 150 ms. L'anneau de focus apparaît instantanément.

## 8. Données et état

- `body[data-view]` : vue active (design, site, assets, models, board), posé par `views.js`.
- `.view-tabs` : `--i` = index de l'onglet actif.
- `.hero__specimen` : texte = domaine du site actif.
- États déjà présents dans le JS : `is-active`, `is-error`, `is-over`, `is-done`, `is-off`, `is-pass`, `is-flagged`, `is-selected`, `copied`.

## 9. Comportement responsive

- Largeur fixe de 560 px. Les fenêtres détachées vont jusqu'à 720 px : `.app` limité à 640 px, centré.
- Chaque grille repasse en 2 colonnes sous 480 px et en 1 colonne sous 360 px.
- Aucun libellé cliquable sur deux lignes (`white-space: nowrap` + ellipse).

## 10. Accessibilité et performance

- Contraste ≥ 4,5:1 pour tout texte, ≥ 3:1 pour les contrôles.
- `:focus-visible` : anneau de 2 px `--view` + décalage de 2 px, sans transition.
- Cible minimale de 28 px.
- Pas de flou ailleurs que sur la barre collante (coût GPU).
- Animations limitées à `transform` et `opacity`.
- Les polices locales sont déclarées en `font-display: swap`.

## 11. Dépendances

Aucune. CSS natif : `oklch`, `color-mix`, `backdrop-filter`, scroll-driven animations (Chrome 115+, sous `@supports`).

## 12. Règles clés

1. Une action = une touche ; une touche active = un témoin.
2. Le verre ne sert qu'à ce qui flotte au-dessus du contenu.
3. Une couleur par vue, jamais deux accents dans un même écran.
4. Les titres sont en Instrument Serif romain ; les données en mono ; le reste en Geist.
5. L'élévation passe par la luminosité, pas par les ombres (sauf le flanc des touches).
6. Pas de dégradé décoratif, pas de texte en dégradé, pas d'aurora.

## 13. Critères de fin

- [ ] Aucun dégradé violet, aucun texte en dégradé, aucun fond en taches floues (`grep -n "background-clip: text\|aurora" popup/popup.css` vide).
- [ ] Verre présent uniquement sur `.view-tabs` (`grep -c "backdrop-filter" popup/popup.css` = 2 : déclaration et préfixe).
- [ ] Chaque vue change `--view` : captures Playwright des 5 vues en nuit et en jour.
- [ ] Parallaxe active au défilement, absente en mouvement réduit.
- [ ] Toutes les classes utilisées par le HTML et le JS sont stylées (script d'inventaire).
- [ ] Suites unitaires et E2E vertes après la refonte.
