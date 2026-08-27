# Chantier 2 — Phase 1 intégrée

## Configuration active

Le backend contient un récepteur SNMP Node.js intégré. Sa configuration reste dans `TAV_Monitoring_Backend/config.json` :

```jsonc
"novastar_traps": {
  "enabled": true,
  "listen_address": "0.0.0.0",
  "advertised_address": "192.168.69.22",
  "port": 1162,
  "configure_devices": true,
  "event_log_file": "./logs/novastar-traps.jsonl",
  "max_log_bytes": 5242880,
  "deduplication_window_ms": 1000
}
```

Au démarrage, le backend vérifie que `advertised_address` est réellement attribuée à la machine. Il écoute ensuite sur UDP 1162. Lors d'un scan NovaStar, `DeviceMonitor` configure séquentiellement la destination `192.168.69.22:1162` puis active les traps avec la communauté d'écriture de la machine.

## Contrôles réseau

Après démarrage :

```powershell
Get-NetUDPEndpoint -LocalPort 1162
```

État applicatif :

```text
GET /api/novastar-traps/status
```

Derniers événements reçus :

```text
GET /api/novastar-traps/events?limit=100
```

Les événements sont également écrits dans `TAV_Monitoring_Backend/logs/novastar-traps.jsonl`.

## Simulation sans manipulation physique

Le backend doit être démarré, puis :

```powershell
$env:TRAP_HOST="127.0.0.1"
$env:TRAP_PORT="1162"
$env:TRAP_KIND="input"
$env:TRAP_SLOT="3"
$env:TRAP_IO_PORT="2"
$env:TRAP_DURATION_MS="250"
npm run simulate:novastar-trap
```

Attention : le récepteur filtre les sources selon les machines NovaStar configurées. Pour une simulation locale adressée à `127.0.0.1`, une machine NovaStar de simulation utilisant cette adresse doit exister, ou il faut utiliser les tests automatisés.

## Limite restant à valider

La MIB indique les OID d'alarmes d'entrée et de sortie, mais pas le format exact des chaînes envoyées par chaque firmware. Les traps non reconnus sont conservés intégralement comme événements inconnus. Le décodeur devra être complété à partir des traps réels reçus sur le réseau, puis confirmé lors de la phase 2 avec des débranchements physiques.
