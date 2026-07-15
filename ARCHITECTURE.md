# Architecture TAV Monitoring

Le monolithe historique reste a la racine comme reference. Les deux nouvelles applications sont independantes :

- `TAV_Monitoring_Backend` : configuration, stockage, communication avec les equipements, scans periodiques, references, API REST et WebSocket.
- `TAV_Monitoring_UI` : serveur Express/EJS, interface utilisateur et proxy vers le backend.

## Flux

1. Le backend lance un scan immediat au demarrage puis toutes les `monitor_interval_s` secondes.
2. Il conserve le dernier resultat de chaque machine en memoire.
3. Un client WebSocket recoit un snapshot complet a la connexion.
4. Un changement de structure, de statut ou de reference produit `monitoring.changed`.
5. Une valeur variable sans effet visuel produit `telemetry.patch`.
6. Le frontend recupere aussi un snapshot REST toutes les `rest_refresh_s` secondes.

## Demarrage

Backend :

```powershell
Set-Location TAV_Monitoring_Backend
npm install
npm start
```

Frontend :

```powershell
Set-Location TAV_Monitoring_UI
npm install
npm start
```

Les ports et adresses se reglent dans le `config.json` de chaque application.

## API principale

- `GET /api/machines`
- `POST /api/machines`
- `PATCH /api/machines/:id`
- `DELETE /api/machines/:id`
- `GET /api/monitoring`
- `POST /api/monitoring/scan`
- `POST /api/machines/:id/scan`
- `PUT /api/machines/:id/reference`
- `PUT /api/config/monitoring-reference-mode`

## Tests

```powershell
node tests\run.js
```

Les tests emploient des equipements simules et ne contactent aucune machine reelle.
