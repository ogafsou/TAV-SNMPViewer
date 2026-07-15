# Kiloview Simulator

Simulateur HTTP autonome compatible avec le connecteur Kiloview de TAV Monitoring.
Il émule les modes encodeur et décodeur et propose une page web pour configurer
l'équipement et injecter des défauts.

## Démarrage

```powershell
cd KiloviewSimulator
npm start
```

Ouvrir `http://localhost:8081`.

Dans TAV Monitoring :

- Type : `Kiloview`
- Hôte / URL : `http://127.0.0.1:8081`
- Nom d'utilisateur et mot de passe : valeurs libres

Le port se configure dans `config.json`. Les variables `HOST` et `PORT` sont
prioritaires. L'état est sauvegardé automatiquement dans `state.json`.

## Défauts simulables

- API indisponible, système et réseau
- Encodeur NDI
- Signal vidéo et signal audio
- Source NDI et sortie vidéo en mode décodeur
- Warnings Kiloview : source hors ligne, URL modifiée, absence vidéo/audio,
  erreur de correspondance et résolution non supportée

## Routes Kiloview émulées

- `POST /api/v1/user/authorize`
- `POST /api/v1/mode/get`
- `POST /api/v1/mode/status`
- `POST /api/v1/sys/server_info`
- `POST /api/v1/network/get`
- `POST /api/v1/encoder/ndi/get_config`
- `POST /api/v1/encoder/ndi/status`
- `POST /api/v1/encoder/ndi/get_audio`
- `POST /api/v1/decoder/current/status`
- `POST /api/v1/decoder/output/get`
