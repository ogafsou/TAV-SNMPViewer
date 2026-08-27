# Point d'étape — 16 août 2026

## Situation générale

Le projet sait maintenant collecter et présenter les états NovaStar par API et
par SNMP. Le modèle commun sépare l'inventaire des observations, conserve la
source de chaque mesure et produit un état réconcilié ainsi qu'un rapport de
divergences.

La suite automatisée comporte actuellement **68 tests réussis sur 68**.

## Chantier 1 — Fiabilisation des I/O

### Terminé

- Les identifiants canoniques des inputs et outputs sont définis.
- L'inventaire est séparé des observations API et SNMP.
- Les observations API et SNMP peuvent coexister dans un même scan hybride.
- Le rapport de divergences compare les états opérationnels communs et évite les
  faux écarts dus aux valeurs brutes différentes.
- La politique de réconciliation est implémentée et configurable.
- Les inputs SNMP sont correctement découverts malgré les slots non contigus.
- Les sources d'entrée utilisent leurs identifiants métier globaux.
- Les outputs SNMP utilisent les sélecteurs exacts
  `outputSlotId/netPortId/recvCardId`.
- Les ports de sortie sont interprétés grâce à `tempStatus` dans le résumé JSON
  `.30.6`.
- Les codes API actifs `2` et `3` sont comparés à l'état SNMP actif `1` sans
  produire de fausse divergence.
- Les receiving cards restent disponibles dans les données détaillées, mais ne
  sont plus affichées comme des équipements supplémentaires ni comparées deux
  fois à la référence.
- La fréquence SNMP est indépendante de la fréquence générale des scans API.
- Chaque NovaStar utilisant SNMP possède un worker logique dédié. Les scans de
  plusieurs NovaStar peuvent donc avancer en parallèle sans paralléliser les
  sélecteurs d'une même machine.
- L'option machine **Scan SNMP** active ou désactive tous les scans SNMP, y
  compris les scans manuels. Sa fréquence vaut 10 minutes par défaut et ne peut
  pas être inférieure à 4 minutes.
- Pour une machine hybride, les cycles API réutilisent le dernier snapshot SNMP
  jusqu'au prochain passage du worker SNMP.

### Constat sur les performances SNMP

Pour chaque port de sortie, la collecte a été réduite à la séquence minimale :

```text
SET .30.4
GET .30.6
```

Les trois lectures redondantes `.30.5.1`, `.30.5.3` et `.30.5.4` ont été
supprimées. Malgré cela, un scan complet de 32 ports reste très long sur le
NovaStar testé.

Les logs montrent qu'après un certain nombre de requêtes rapprochées, un `SET`
ou un `GET` peut prendre environ 2,5 secondes. Le comportement observé correspond
probablement à l'expiration de la première tentative puis à une réponse lors de
la tentative suivante. Un port peut donc prendre environ 5 secondes et le scan
complet entre 2 min 30 et 3 minutes.

Le planificateur n'empile pas les scans d'une même machine. Chaque worker SNMP
conserve au plus un travail actif et passe toujours par
`MonitoringService.scanMachine()`. Les workers de NovaStar différents sont
indépendants, tandis que les sélecteurs d'un même agent restent strictement
séquentiels.

### Reste à valider

- Mesurer plusieurs scans complets en conditions réelles.
- Comparer les snapshots API, SNMP et hybrides après stabilisation.
- Réaliser les tests contrôlés de perte et de restauration.
- Valider définitivement la politique de réconciliation.
- Déployer puis observer les divergences restantes.

Un verrou FIFO partagé par `host:port` est maintenant appliqué aux scans NovaStar
et à la configuration des traps. Il sérialise aussi deux identifiants machine
visant le même agent, sans bloquer l'API ni les autres NovaStar. Les logs
`NovaStarSnmpLock` permettent encore de valider ce comportement sur la cible.
Ce verrou reste local au processus backend : un second backend ou un outil SNMP
externe nécessiterait un verrou distribué.

## Chantier 2 — Microcoupures

La phase logicielle est en place :

- récepteur de traps SNMP intégré au backend Node.js ;
- écoute configurable sur UDP 1162 ;
- configuration de la destination des traps par SNMP SET ;
- journalisation, déduplication et conservation des événements bruts ;
- corrélation d'une perte et de son rétablissement ;
- diffusion par API et WebSocket ;
- cadre rouge temporaire sur l'élément concerné ;
- simulateur et tests automatisés.

Il reste principalement à recevoir et analyser des traps réels, confirmer les OID
et formats des pertes/rétablissements, puis effectuer les tests physiques de
microcoupure lorsque l'accès le permettra.

## Idées pour la suite

1. **Exposer un statut Trap SNMP par NovaStar.** Distinguer le récepteur actif,
   la réussite des `SET`, la configuration éventuellement relue et la date du
   dernier trap réellement reçu.

2. **Valider la nouvelle planification sur la cible.** Mesurer plusieurs workers
   NovaStar simultanés, vérifier l'absence de chevauchement sur une même machine
   et confirmer le comportement des scans manuels avec **Scan SNMP** activé puis
   désactivé.

3. **Terminer les validations terrain.** Capturer les traps réels, confirmer les
   formats perte/rétablissement, réaliser les tests contrôlés de déconnexion et
   arrêter définitivement la politique de réconciliation.
