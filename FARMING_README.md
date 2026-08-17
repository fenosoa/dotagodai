# Farming Path Viewer 🗺️

`farming.html` est une page web autonome qui rejoue, sur la minimap de Dota 2, le
trajet d'un héros au fil du match ainsi que sa progression en last hits / gold.
Elle s'appuie sur `viewer.js` et sur un fichier JSON de samples (positions +
stats dans le temps) généré par la tâche Gradle `pathRun` (voir [README.md](README.md)).

## ⚙️ Fonctionnement (analyse de `viewer.js`)

### 1. Chargement des données

`dota2_map.png` est chargée au démarrage et affichée immédiatement dans le
canvas. Il n'y a **plus de fichier codé en dur** : le path à visualiser est
fourni par l'utilisateur via une zone de **drag & drop** superposée au canvas
(`#dropOverlay`), qui accepte deux types de fichiers :

- **Un fichier `.json`** déjà au format samples (voir schéma plus bas) → chargé
  directement côté client (`FileReader`), aucun aller-retour serveur.
- **Un replay `.dem`** → déclenche tout un pipeline serveur (upload → liste des
  joueurs → extraction du path du joueur choisi), détaillé ci-dessous.

On peut aussi **cliquer** sur la zone de drop pour ouvrir un sélecteur de
fichier (`<input type="file" id="fileInput">`), qui accepte les deux types.
Dans les deux cas on peut changer de trajet à tout moment en redéposant un
autre fichier, sans recharger la page — `loadSamplesFromData(data, label)`
réinitialise l'état de lecture (temps courant, slider, play/pause, couleur du
LH) et réaffiche le tracé.

#### Flux `.json` (hors-ligne)

`readJsonFile()` lit le fichier avec `FileReader`, le parse en JSON, puis
appelle `loadSamplesFromData()`. Comme ça ne passe pas par `fetch()`, ce flux
fonctionne même en ouvrant `farming.html` directement en `file://`.

#### Flux `.dem` (nécessite le serveur `server.js`)

Quand un `.dem` est déposé, `handleDemFile()` orchestre trois appels HTTP
successifs vers `server.js` (un overlay de statut avec spinner s'affiche
pendant chaque étape) :

1. **`POST /api/replays/upload`** (multipart) — le fichier est uploadé et
   sauvegardé côté serveur. C'est nécessaire car un `File` glissé-déposé dans
   un navigateur n'expose que ses octets, jamais un chemin disque réel — or
   `pathRun`/`matchinfoRun` (Gradle/Clarity) ont besoin d'un vrai fichier sur
   disque.
2. **`POST /api/parse-replay`** — lance la tâche Gradle `matchinfoRun` sur le
   replay uploadé et renvoie la liste des 10 joueurs (`playerId`, `heroName`,
   `playerName`, `team`). `showPlayerPicker()` affiche alors une grille de
   cartes cliquables (`#playerPicker`), une par joueur.
3. Au clic sur un joueur, **`POST /api/path`** lance `pathRun` avec le
   `playerId` choisi, et le tableau de samples renvoyé est passé directement à
   `loadSamplesFromData()` — le path s'affiche sans jamais transiter par un
   fichier `.json` intermédiaire côté client.

Ce flux nécessite donc de servir la page via le serveur du projet :

```bash
npm start
# puis ouvrez http://localhost:3000/farming.html
```

### 2. Système de coordonnées

Le canvas est redimensionné à la taille de `dota2_map.png`, et chaque
position `(x, y)` du monde Dota 2 est convertie en pixels via `worldToCanvas()` :

```js
const BASE_MIN = 9684;
const BASE_MAX = 23034;
const MAP_SPAN = BASE_MAX - BASE_MIN;
const PADDING = MAP_SPAN * 0.05;
const MAP_MIN = BASE_MIN - PADDING;
const MAP_MAX = BASE_MAX + PADDING;
```

- `x` et `y` sont supposés être des coordonnées "monde" Dota 2 classiques
  (à peu près dans l'intervalle `[9684, 23034]`, avec 5 % de marge ajoutée
  de chaque côté).
- L'axe Y est inversé (`1 - ny`) car dans Dota 2 un Y plus grand est "plus
  haut sur la carte", alors qu'en canvas Y grandit vers le bas.

Si vous fournissez des coordonnées dans un autre référentiel (ex. coordonnées
minimap normalisées 0–1, ou un autre système de cellules), il faudra soit les
convertir vers ce référentiel monde avant export, soit adapter `BASE_MIN` /
`BASE_MAX` dans `viewer.js`.

### 3. Lecture temporelle

- `minT` / `maxT` = `samples[0].t` et `samples[last].t` (le tableau **doit
  être trié par `t` croissant**).
- Le slider représente un ratio `0..1` entre `minT` et `maxT`.
- `getSampleAtTime(t)` interpole linéairement `x`/`y` entre les deux samples
  encadrant `t` (les autres champs — `lastHits`, `creepGold`, etc. — viennent
  du sample de gauche, pas interpolés).
- `formatGameTime()` affiche l'heure de jeu avec un décalage
  `GAME_START_OFFSET_SECONDS = -120` (le temps `t=0` du fichier correspond au
  début de l'enregistrement du replay, ~2 min avant le "0:00" officiel du
  strategy timer / horn).
- Vitesses de lecture disponibles : `0.5x, 1x, 1.5x, 2x, 4x, 8x, 16x, 32x`.

### 4. Rendu du tracé

Le chemin est tracé comme une polyline segmentée **par minute de jeu**
(`Math.floor(s.t / 60)`), chaque minute ayant sa couleur dans un cycle de 6 :

```js
const PATH_COLORS = ['#00ff99', '#00bcd4', '#ffeb3b', '#ff9800', '#f44336', '#9c27b0'];
```

Un point rouge marque la position actuelle du héros.

### 5. Panneau de stats

Pour le sample courant (ou interpolé) :

- **LH** : `lastHits`, affiché en gros. Sa couleur change selon la dernière
  source de gold gagnée entre les deux derniers samples réels (vert = creeps
  de lane, bleu = neutral creeps, jaune = valeur par défaut / kill sur héros).
- **Total gold** : `creepGold + neutralGold + heroKillGold`.
- Trois lignes de pourcentage montrant la répartition du gold entre creeps de
  lane, neutrals et kills sur héros.

Tous les champs manquants sont traités comme `0` (`display.creepGold || 0`,
etc.), donc un sample incomplet ne casse pas l'affichage — il fausse juste
les stats.

## 🔌 API serveur (flux `.dem`)

Ajoutées dans `server.js` pour le flux `.dem` de `farming.html` :

| Endpoint | Méthode | Body | Réponse |
|---|---|---|---|
| `/api/replays/upload` | POST | `multipart/form-data`, champ `replay` | `{ success, path, name, size }` |
| `/api/parse-replay` | POST | `{ filePath }` | `{ success, data: { players: [...], ... } }` (lance `matchinfoRun`) |
| `/api/path` | POST | `{ filePath, playerId }` | `{ success, data: [...samples] }` (lance `pathRun`) |

Les deux derniers appellent Gradle via un helper commun (`runGradleTask()`)
qui construit la commande `--args` pour `gradlew.bat`. **Contrainte
importante découverte en testant contre un vrai replay** : sur Windows, la
valeur de `--args` ne survit correctement le passage à travers
`cmd.exe`/`gradlew.bat`/Gradle que si **aucun argument individuel ne contient
d'espace ni de guillemet** (les tentatives de guillemets imbriqués pour gérer
des chemins avec espaces se font systématiquement mal découper). C'est pour
ça que les fichiers uploadés/générés sont stockés dans `.gradle-io/` (dossier
local au projet, donc garanti sans espace) plutôt que dans `os.tmpdir()` (qui
peut contenir le nom d'utilisateur Windows, potentiellement espacé). Si un
`filePath` contient un espace, `runGradleTask()` renvoie une erreur 500
explicite plutôt que de tenter un appel qui échouerait silencieusement.

### Limitations connues de `matchinfoRun`

En testant contre un vrai replay, deux bugs pré-existants (indépendants du
flux `.dem` lui-même) ont été trouvés et corrigés dans
`src/main/java/skadistats/clarity/examples/matchinfo/Main.java` :

- Le code ne compilait pas (comparaison `int == null` sur plusieurs champs).
- Les stats n'étaient extraites que si `m_nGameState` atteignait `POST_GAME`
  pendant le parsing ; sur certains replays ce flag ne se déclenche jamais →
  extraction déplacée en fin de parsing (`finalizeIfNeeded()`), quel que soit
  l'état observé.
- La liste des joueurs supposait un `m_iPlayerID` pair (`0,2,4,6,8` /
  `10,12,14,16,18`) ; certains replays utilisent en fait une numérotation
  séquentielle (`0-4` Radiant / `5-9` Dire). Le roster est maintenant construit
  à partir des `playerId` réellement observés sur les entités héros, et
  nom/équipe viennent de `CDOTA_PlayerResource.m_vecPlayerData` (indexé
  directement par `playerId`, fiable quel que soit le schéma de numérotation).

Ce qui reste imparfait (hors périmètre du sélecteur de joueur, qui n'en a pas
besoin) : `matchId`, `duration`, `gameMode`, `winner`, et les kills/deaths/
assists/GPM/XPM par joueur peuvent rester à `0`/`"Unknown"` sur certains
replays — les noms des propriétés Source 2 correspondantes n'ont pas été
vérifiées aussi profondément que celles utilisées par `pathRun`.

## 📦 Format JSON attendu

`viewer.js` attend un **tableau JSON trié par `t` croissant** d'objets avec
ce schéma :

```json
[
  {
    "t": 0.000,
    "x": 23284.000,
    "y": 23034.000,
    "lastHits": 0,
    "creepGold": 0,
    "neutralGold": 0,
    "heroKillGold": 0
  }
]
```

| Champ          | Type   | Utilisé pour                                              |
|-----------------|--------|-------------------------------------------------------------|
| `t`             | number | temps relatif en secondes, doit être croissant             |
| `x`, `y`        | number | coordonnées monde Dota 2 (voir système de coordonnées)     |
| `lastHits`      | int    | affiché en gros dans le panneau de stats                   |
| `creepGold`     | int    | gold cumulé venant des creeps de lane                      |
| `neutralGold`   | int    | gold cumulé venant des creeps neutres                      |
| `heroKillGold`  | int    | gold cumulé venant des kills sur héros                     |

Tous les champs numériques sont attendus **cumulatifs** (valeur totale à
l'instant `t`, pas un delta) : c'est ce qui permet à `draw()` de calculer les
diffs entre deux samples consécutifs pour détecter "qu'est-ce qui vient d'être
farm".

## 🏗️ Comment générer un JSON compatible

### Option recommandée : déposer le `.dem` directement dans `farming.html`

Le plus simple : glissez le fichier `.dem` sur la zone de drop de
`farming.html` (serveur démarré, voir plus bas). Le pipeline
upload → liste des joueurs → `pathRun` décrit plus haut s'occupe de tout ; pas
besoin de connaître le Player ID à l'avance, ni de taper de commande Gradle.

### Option manuelle : la tâche Gradle `pathRun` en ligne de commande

Utile pour scripter/batcher, ou si vous connaissez déjà le Player ID. C'est
ce que produit `src/main/java/skadistats/clarity/examples/path/Main.java` :
il track un héros par son `PlayerID`, échantillonne toutes les 8 ticks
(~0,27 s à 30 tick/s) et écrit exactement le schéma ci-dessus.

```cmd
gradlew.bat pathRun --args "<replay.dem> <player-id> <output.json>"
```

Exemple :

```cmd
gradlew.bat pathRun --args "C:\replays\8563191677.dem 0 jug_ame.json"
```

Voir [README.md](README.md) pour le détail des Player IDs Radiant/Dire.

Une fois le fichier généré, **glissez-le directement sur le canvas** de
`farming.html` (ou cliquez sur la zone de drop pour le sélectionner) — plus
besoin d'éditer `viewer.js` ni de le placer à un endroit précis.

### Option alternative : générer le JSON autrement

Si vous voulez alimenter `farming.html` depuis une autre source (autre
parser de replay, export depuis une API stats, etc.), il suffit de produire
un tableau respectant strictement le schéma ci-dessus :

1. Trier les échantillons par `t` croissant.
2. Utiliser des coordonnées monde compatibles avec `BASE_MIN`/`BASE_MAX`
   (`9684`–`23034`) — ou adapter ces constantes dans `viewer.js` si votre
   source utilise un autre repère (ex. cellules Source engine
   `world = cellX * 128 + vecX`, comme fait `Main.java`).
3. Fournir des valeurs de gold **cumulatives**, pas des deltas.
4. Déposer le fichier `.json` sur la zone de drop de `farming.html`.

## 🚀 Lancer la page

```bash
npm install   # une seule fois
npm start
```

Puis ouvrez `http://localhost:3000/farming.html`.
