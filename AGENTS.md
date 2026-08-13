# Consignes d'architecture du projet

## Sélecteurs SNMP NovaStar

- Une seule configuration NovaStar doit pointer vers une même adresse IP et un
  même port SNMP.
- Toutes les collectes NovaStar SNMP doivent être orchestrées par
  `TAV_Monitoring_Backend/services/DeviceMonitor.js` et déclenchées via
  `MonitoringService.scanMachine()`.
- Le code de production ne doit pas importer, instancier ni appeler directement
  `TAV_Monitoring_Backend/classes/SnmpLib.js` depuis un autre module.
- Les tests peuvent importer directement le connecteur pour valider son
  comportement isolément.
- Toute nouvelle collecte indépendante, tout second processus backend ou toute
  possibilité de plusieurs configurations sur la même IP invalide cette
  hypothèse. Dans ce cas, arrêter l'implémentation et signaler explicitement
  qu'un verrou partagé par agent NovaStar (`host:port`) doit être conçu avant de
  poursuivre.
- Conserver les parcours à sélecteur strictement séquentiels :
  `SET -> GET associés -> sélecteur suivant`.

