# TAV Monitoring Backend

Service Node.js/Express responsable des machines et du monitoring.

Configuration : `config.json`.

- `port` : port HTTP et WebSocket.
- `monitor_interval_s` : intervalle des scans automatiques, `0` pour les desactiver.
- `machines_file` : fichier persistant des machines et references.
- `monitoring_reference_mode` : active la comparaison aux references.
- `max_parallel_scans` : nombre maximal de scans simultanes.

## Alertes ntfy

La section `alerts` permet d'envoyer les changements confirmes vers un topic ntfy :

- `enabled` : active ou desactive les alertes ;
- `server_url` : serveur ntfy, `https://ntfy.sh` pour le service public ;
- `topic` : nom du topic, a conserver confidentiel avec l'offre gratuite ;
- `token` : token Bearer optionnel pour une future offre authentifiee ;
- `frontend_url` : lien ouvert au toucher de la notification ;
- `failure_threshold` : nombre de scans problematiques consecutifs avant l'alerte ;
- `recovery_threshold` : nombre de scans sains consecutifs avant le retablissement ;
- `notify_recovery` : envoie une notification verte de retour a la normale ;
- `request_timeout_ms` : timeout d'un envoi ntfy, sans bloquer le scan.

Le topic et le token ne sont jamais renvoyes par `GET /api/config`. Pour tester la
connexion depuis le backend, utiliser `POST /api/alerts/test`. Les alertes sont
agregees par machine et ne sont pas repetees tant que l'etat ne change pas.

Le WebSocket standard est disponible sur `/ws`.

## API NovaStar H

Le connecteur par defaut utilise l'OpenAPI officielle sous `/open/api`. Pour une
machine NovaStar configuree en API, les champs principaux sont :

- `apiProtocol` : `openapi` (recommande) ou `legacy` ;
- `apiProjectId` : Project ID (`pId`) cree dans OpenAPI Management ;
- `apiSecretKey` : cle requise uniquement lorsque le chiffrement est actif ;
- `apiEncryption` : active le corps DES et la signature avec Secret Key ;
- `apiDeviceId` : identifiant du device, `0` par defaut ;
- `apiBaseUrl` : surcharge optionnelle. Par defaut, le backend utilise
  `http://<host>:8000/open/api` en OpenAPI et `http://<host>` en legacy.

Les machines existantes sans `apiProtocol` et sans `apiProjectId` restent en
legacy afin de ne pas casser leur configuration. Le connecteur web historique
est sauvegarde dans `classes/NovaStarApiLib-backup.js`.
