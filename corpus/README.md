# Corpus PROMPT_PRO

Prompts étudiés pour calibrer [lib/prompt-pro-playbook.mjs](../lib/prompt-pro-playbook.mjs). Le playbook en tire des mesures (longueur, stack, motion, polices) ; aucun prompt n'y est recopié.

| Dossier | Source | Licence | Prompts | Étude |
| --- | --- | --- | --- | --- |
| `winter-motionsites-prompts/` | dépôt winter-motionsites-prompts, scrapé de motionsites.ai le 2026-07-12 (copie de `Downloads\Compressed\winter-motionsites-prompts-main`, sans `.workbuddy/`) | aucune déclarée | 109 (`prompts/*.md` + `prompts/premium/`) | étude combinée |
| `awesome-web-prompts/` | DexZane/awesome-web-prompts | MIT | 72 (`prompts/**/prompt.md`) | étude combinée |
| `ajouts-manuels/` | prompts collés par l'utilisateur le 2026-10-16 (détail ci-dessous) | inconnue | 4 (`*.md`) | étude combinée ; stack vanilla par défaut, règles de la barre qualité, 6 recettes |

`ajouts-manuels/` :

| Fichier | Apport au playbook | Remarque |
| --- | --- | --- |
| `mostar-city.md` | `scrollStage`, `loopCarousel` | complet |
| `driftbar-meadow-footer.md` | `glassWordmark`, `unitScaling` (repli svh) | complet |
| `planet-jumping-portal.md` | `portalWindow` | complet |
| `ethan-vale-wildlife-archive.md` | `sphereGallery` | **tronqué** à « CAMERA LOOP » (limite de 50 000 caractères du message) ; `awesome-web-prompts/.../photography/nature-portfolio/prompt.md` n'en contient qu'un résumé de 440 caractères |

Collés mais non ajoutés, car déjà présents : Vesper.ai (`awesome-web-prompts/.../ai/agent-wave`, source de `failSafeEntrance`), Jack 3D Creator (`3d-jack-portfolio-hero.md` + `portfolio/3d-portfolio`), Mainframe (`retro-futurist.md` + `hero/retro-futurist`, seule l'URL vidéo diffère). Les compter deux fois fausserait l'étude.

`npm run study:prompts` mesure les trois sources et écrit `study.json` : par source, combiné, et `combined.byStack` (vanilla contre React). Au 2026-10-16 : 185 prompts. Un nouveau prompt va dans `ajouts-manuels/` (en fichier `.md` s'il dépasse 50 000 caractères), puis on relance l'étude.

Le dépôt winter n'a pas de licence. Ne pas publier ce dossier tant que les droits ne sont pas clarifiés.
