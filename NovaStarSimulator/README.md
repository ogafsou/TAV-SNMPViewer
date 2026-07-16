# NovaStar Simulator

Simulateur HTTP autonome d'une matrice NovaStar H. Il reproduit les routes API
utilisees par `classes/NovaStarApiLib.js` dans SNMPViewer et fournit une interface
web pour configurer les cartes et injecter des defauts.

## Demarrage

```powershell
cd NovaStarSimulator
npm start
```

Ouvrir ensuite `http://localhost:8080`. L'adresse et le port se reglent dans
`config.json`. Les variables d'environnement `HOST` et `PORT` restent prioritaires.

Dans SNMPViewer, utiliser :

- Type : `NovaStar H`
- Source des informations : `api`
- URL API : `http://127.0.0.1:8080`
- Identifiants : n'importe quelles valeurs (par exemple `admin` / `admin`)

La configuration est sauvegardee automatiquement dans `state.json`. Ce fichier
n'est pas versionne. Le bouton **Reinitialiser** restaure le profil H9 par defaut.

## API du simulateur

- `POST /api/user/login`
- `POST /api/device/readDetail`
- `POST /api/device/readGenLockWorkStatus`
- `POST /api/main/readVideoServerInfo`
- `POST /api/main/initStatus`
- `POST /open/api/device/readDetail` (`pId`: `simulator`)
- `POST /open/api/main/readVideoServerInfo` (`pId`: `simulator`)
- `POST /open/api/main/initStatus` (`pId`: `simulator`)
- `GET /simulator/api/state`
- `PUT /simulator/api/config`
- `PATCH /simulator/api/component`
- `POST /simulator/api/reset`

Les routes NovaStar exigent le jeton retourne par le login, comme l'equipement.
