# TAV Monitoring UI

Interface Node.js/Express/EJS. Elle ne contacte jamais directement les equipements.

Configuration : `config.json`.

- `port` : port d'ecoute de l'interface.
- `backend_rest_url` : adresse HTTP du backend.
- `backend_ws_url` : adresse WebSocket du backend.
- `rest_refresh_s` : intervalle de resynchronisation REST complete.

Le navigateur utilise les chemins locaux `/api` et `/ws`; le serveur UI relaie les communications vers le backend configure.
