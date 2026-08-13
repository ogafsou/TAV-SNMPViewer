# Chantier 1 — Fiabilisation de la récupération des états I/O

## Situation actuelle

La phase A avait été découpée ainsi :

1. Formaliser les identifiants canoniques — **terminé**.
2. Séparer inventaire et observations — **terminé**.
3. Ajouter un verrou SNMP par équipement — **mis de côté sous conditions**.
4. Collecter API et SNMP — **implémenté, validation SNMP en production restante**.
5. Construire le rapport de divergences — **terminé**.
6. Faire des tests de déconnexion contrôlée — **à faire sur le NovaStar réel**.
7. Fixer la politique de réconciliation — **implémentée, à valider avec les résultats réels**.
8. Déployer et observer — **à faire**.

## Ce qu’il reste à faire

### 1. Valider la collecte SNMP sur la machine cible (fin du point 4)

- Déployer ou exécuter la version actuelle du backend sur la machine ayant accès au NovaStar.
- Vérifier que les communautés de lecture et d’écriture utilisées sont bien `public`.
- Confirmer dans les logs que les parcours de sélecteurs respectent l’ordre séquentiel : `SET -> GET associés -> sélecteur suivant`.
- Vérifier que tous les écrans, slots d’entrée, slots de sortie et ports attendus sont découverts.
- Comparer les observations SNMP avec celles de l’API intégrée Node.
- Contrôler que les erreurs partielles SNMP ne font pas disparaître à tort des éléments de l’inventaire.

Critère de fin : plusieurs scans consécutifs produisent un inventaire et des observations SNMP complets et stables sur le NovaStar réel.

### 2. Réaliser les tests de déconnexion contrôlée (point 6)

Effectuer des coupures maîtrisées, une par une, puis laisser au moins un scan complet entre chaque manipulation :

- perte d’un signal d’entrée ;
- perte d’une sortie ;
- déconnexion ou indisponibilité d’une carte si le test est possible sans risque ;
- indisponibilité temporaire de l’API ;
- indisponibilité temporaire de SNMP ;
- restauration de chaque élément.

Pour chaque scénario, relever :

- les observations API et SNMP ;
- le rapport de divergences ;
- l’état réconcilié affiché ;
- le nombre de scans nécessaire pour signaler le défaut puis confirmer le retour à la normale ;
- les éventuels faux positifs, doublons ou éléments manquants.

Critère de fin : les comportements des deux sources et leurs divergences sont connus pour chaque scénario utile.

### 3. Valider et ajuster la politique de réconciliation (fin du point 7)

La politique est configurable dans `io_reconciliation`. Il reste à déterminer les valeurs définitives à partir des essais réels, notamment :

- la stratégie opérationnelle à conserver (`worst-valid-state`, `best-valid-state` ou une autre stratégie prévue) ;
- le comportement lorsqu’une seule source répond ;
- le traitement d’un état absent ou invalide ;
- le nombre de scans confirmant un retour à la normale ;
- le nombre de scans confirmant la disparition d’un élément de l’inventaire.

Vérifier également que l’interface explique suffisamment la source retenue et les divergences, sans masquer une information importante.

Critère de fin : une politique documentée est choisie, configurée et validée sur les scénarios du point 6.

### 4. Déployer et observer (point 8)

- Déployer la configuration de réconciliation retenue sur la cible.
- Observer plusieurs cycles de production, idéalement pendant une période représentative d’exploitation.
- Examiner régulièrement les rapports de divergences et les logs de collecte.
- Identifier les divergences récurrentes et déterminer si elles proviennent de l’API, de SNMP, du rapprochement des identifiants ou d’un véritable défaut matériel.
- Corriger les derniers cas particuliers puis refaire les scénarios concernés.

Critère de fin : la collecte reste stable en production, les états affichés sont fiables et les divergences restantes sont comprises ou explicitement acceptées.

## Condition concernant le verrou SNMP (point 3)

Aucun verrou complexe n’est nécessaire tant que toutes les conditions suivantes restent vraies :

- une seule configuration NovaStar pointe vers une même paire `IP:port SNMP` ;
- toutes les requêtes SNMP proviennent uniquement de `TAV_Monitoring_Backend` ;
- les collectes passent par `DeviceMonitor.js` et sont déclenchées via `MonitoringService.scanMachine()` ;
- aucun second processus ou service ne manipule les sélecteurs ;
- les parcours utilisant les sélecteurs restent strictement séquentiels.

Si l’une de ces conditions change, arrêter l’évolution concernée et concevoir d’abord un verrou partagé par agent NovaStar, identifié par `host:port`.

## Ordre recommandé à la reprise

1. Terminer la validation SNMP du point 4 sur la cible.
2. Exécuter et documenter les tests contrôlés du point 6.
3. Ajuster puis valider définitivement la politique du point 7.
4. Déployer et observer selon le point 8.

La détection des microcoupures par traps SNMP appartient au chantier 2 et n’entre pas dans les critères de clôture de ce chantier 1.
