# Dota 2 Replay Explorer 🎮

Un explorateur Web moderne pour analyser et visualiser vos replays Dota 2 (.dem files).

## ✨ Fonctionnalités

- **Scan automatique** du dossier de replays Dota 2
- **Parsing de replays** pour extraire les informations de match
- **Interface moderne** avec design dark élégant
- **Détails complets** : joueurs, héros, KDA, GPM, XPM, etc.
- **Visualisation des paths** de farming (via viewer.js)

## 🚀 Installation

### Prérequis

- Java 17+
- Node.js 16+
- Windows (pour l'accès à Steam/Dota 2)

### Étapes d'installation

1. **Installer les dépendances Node.js** :
```bash
npm install
```

2. **Compiler le projet Java** (si pas déjà fait) :
```bash
gradlew.bat build
```

## 📖 Utilisation

### 1. Démarrer le serveur backend

```bash
npm start
```

Le serveur démarre sur `http://localhost:3000`

### 2. Ouvrir l'explorateur

Ouvrez votre navigateur et allez sur :
```
http://localhost:3000/dem-explorer.html
```

### 3. Scanner les replays

- Cliquez sur **"Scanner dossier Dota 2"** pour charger automatiquement tous les fichiers .dem
- Le chemin par défaut est : `C:\Program Files (x86)\Steam\steamapps\common\dota 2 beta\game\dota\replays`

### 4. Parser un replay

1. Cliquez sur un replay dans la liste
2. Dans la modale, cliquez sur **"Parser le replay"**
3. Attendez quelques secondes (le parsing peut prendre 5-30s selon la taille du fichier)
4. Visualisez les résultats :
   - **Map Info** : Durée, mode de jeu, vainqueur
   - **Joueurs** : Stats détaillées par joueur (KDA, GPM, XPM, etc.)
   - **Statistiques globales** : Kills totaux par équipe

## 🛠️ Structure du projet

```
clarity-examples/
├── src/
│   └── main/java/skadistats/clarity/examples/
│       ├── path/              # Extraction de paths de farming
│       └── matchinfo/         # Nouveau: extraction d'infos de match
├── dem-explorer.html          # Interface Web principale
├── dem-explorer.css           # Styles
├── dem-explorer.js            # Logique frontend
├── server.js                  # Serveur Node.js backend
├── package.json               # Dépendances Node.js
└── build.gradle.kts           # Configuration Gradle
```

## 📝 API Backend

### GET `/api/scan-directory`

Scan un répertoire pour trouver les fichiers .dem

**Query params:**
- `dir` (optionnel) : Chemin du répertoire à scanner

**Réponse:**
```json
{
  "directory": "C:\\...",
  "files": [
    {
      "name": "match_12345.dem",
      "path": "C:\\...\\match_12345.dem",
      "size": 123456,
      "modified": "2025-12-08T01:00:00.000Z"
    }
  ],
  "count": 1
}
```

### POST `/api/parse-replay`

Parse un fichier .dem et retourne les informations de match

**Body:**
```json
{
  "filePath": "C:\\path\\to\\replay.dem"
}
```

**Réponse:**
```json
{
  "success": true,
  "data": {
    "matchId": "123456789",
    "gameMode": "All Pick",
    "duration": 2700,
    "durationFormatted": "45:00",
    "winner": "Radiant",
    "totalKills": 50,
    "players": [
      {
        "playerId": 0,
        "playerName": "PlayerName",
        "heroName": "Anti Mage",
        "team": "radiant",
        "kills": 12,
        "deaths": 3,
        "assists": 8,
        "gpm": 650,
        "xpm": 720,
        ...
      }
    ]
  }
}
```

## 🎨 Commandes Gradle disponibles

### Parser un match spécifique

```bash
gradlew.bat matchinfoRun --args="path/to/replay.dem output.json"
```

### Extraire le path de farming d'un joueur

```bash
gradlew.bat pathRun --args="replay.dem player_id output.json"
```

Où `player_id` est l'ID du joueur (0, 2, 4, 6, 8 pour Radiant; 10, 12, 14, 16, 18 pour Dire)

## 🔧 Configuration

Pour changer le chemin par défaut des replays, éditez `server.js` :

```javascript
const DEFAULT_DOTA_PATH = path.join(
    'C:',
    'Program Files (x86)',
    'Steam',
    'steamapps',
    'common',
    'dota 2 beta',
    'game',
    'dota',
    'replays'
);
```

## 🐛 Dépannage

### Erreur "Impossible de se connecter au serveur"

- Vérifiez que le serveur Node.js est démarré (`npm start`)
- Vérifiez que le port 3000 n'est pas utilisé par une autre application

### Erreur lors du parsing

- Assurez-vous que Java 17+ est installé et dans le PATH
- Vérifiez que `gradlew.bat` est exécutable
- Le parsing peut prendre du temps pour les gros fichiers

### Aucun fichier trouvé lors du scan

- Vérifiez le chemin d'installation de Dota 2
- Vérifiez que vous avez des replays téléchargés dans le dossier

## 📄 Licence

MIT License - See LICENSE file

## 🤝 Contribution

Les contributions sont bienvenues ! N'hésitez pas à ouvrir une issue ou une pull request.

---

Créé avec ❤️ pour la communauté Dota 2
