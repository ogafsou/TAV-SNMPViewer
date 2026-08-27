# TODO consolidée — 16 août 2026

Ce document consolide les travaux restant à réaliser à partir de `Point.md`,
`Chantier1-todo.md` et `Chantier2-todo.md`. L'ordre proposé tient compte des
dépendances techniques et des validations nécessaires avant toute manipulation
physique.

## Principes à conserver pendant tous les travaux

- Une seule configuration NovaStar doit pointer vers une même paire
  `IP:port SNMP`.
- Toutes les collectes SNMP de production doivent rester orchestrées par
  `TAV_Monitoring_Backend/services/DeviceMonitor.js` et déclenchées via
  `MonitoringService.scanMachine()`.
- Aucun autre processus ne doit utiliser les sélecteurs pendant que le backend
  fonctionne. Pour des diagnostics SNMP manuels depuis Cygwin, arrêter le
  backend au préalable.
- Les workers de NovaStar différents peuvent travailler en parallèle, mais le
  parcours d'une même machine doit rester strictement séquentiel :
  `SET -> GET associés -> sélecteur suivant`.
- Le verrou partagé en mémoire sérialise désormais les configurations du backend
  visant le même `host:port`. Il ne couvre pas un deuxième processus backend ou
  un outil SNMP externe : dans ces cas, arrêter l'évolution et concevoir un
  verrou distribué avant de poursuivre.
- Ne pas déduire le sens de traps inconnus. Conserver leurs données brutes et ne
  compléter le décodeur qu'à partir de formats réellement observés.

# Partie 0 — Travail terminé

## 1. Préparation et contrôle de la configuration cible — terminé le 16 août 2026

Les contrôles suivants ont été effectués et validés :

1. La configuration, `machines.json`, les références et les journaux déployés ont
   été sauvegardés ou contrôlés.
2. Une seule machine configurée correspond à chaque paire `IP:port SNMP`.
3. Les communautés enregistrées pour chaque NovaStar ont été vérifiées :
   - lecture : `public` ;
   - écriture : `public`.
4. Les anciennes valeurs explicites incorrectes, par exemple `private`, ont été
   écartées ou corrigées.
5. La section `novastar_traps` de `config.json` a été vérifiée :

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

6. `advertised_address` appartient bien à la machine backend et est joignable
   depuis les NovaStar.
7. Le port UDP `1162` n'est pas utilisé par un autre programme ou par
   `snmptrapd`.

## 2. Option Trap SNMP par machine — terminée le 16 août 2026

1. La case **Trap SNMP** est fonctionnelle dans l'interface.
2. Sa valeur est persistée dans le modèle machine et exposée par les API de
   configuration.
3. **Trap SNMP** est indépendante de **Scan SNMP**.
4. La destination et l'activation des traps ne sont configurées que sur les
   NovaStar dont **Trap SNMP** est activée.
5. Le comportement validé de **Scan SNMP** est conservé :
   - fréquence indépendante par machine ;
   - 10 minutes par défaut ;
   - 4 minutes minimum ;
   - contrôle des scans périodiques et manuels.
6. Les tests automatisés couvrent les quatre combinaisons :
   - scan désactivé, traps désactivés ;
   - scan activé, traps désactivés ;
   - scan désactivé, traps activés ;
   - scan activé, traps activés.
7. Le récepteur ignore les traps provenant d'une machine dont **Trap SNMP** est
   désactivée.
8. La suite automatisée comporte **68 tests réussis sur 68**.

## 3. Déploiement de la planification SNMP — partiellement validé le 16 août 2026

1. Le backend et l'interface contenant les workers par NovaStar et les options
   **Scan SNMP** et **Trap SNMP** ont été déployés.
2. Les services ont redémarré correctement ; le récepteur de traps écoute sur
   `0.0.0.0:1162` et annonce `192.168.69.22:1162`.
3. Les logs confirment un worker à 600 secondes pour chaque NovaStar activé :
   - `192.168.69.86` ;
   - `192.168.69.85` après son activation.
4. Les cycles API de 30 secondes continuent à démarrer et à se terminer pendant
   les scans SNMP longs. Les voies API et SNMP d'une machine sont donc bien
   indépendantes.
5. Les parcours individuels observés conservent l'ordre séquentiel des
   sélecteurs.
6. **Anomalie bloquante observée :** deux identifiants machine différents ont
   lancé simultanément un scan vers `192.168.69.86:161` entre
   `09:36:55.740Z` et `09:37:23.549Z`. Cela peut arriver lors du remplacement ou
   de la recréation d'une configuration pendant que l'ancien scan est encore
   actif. La garantie par identifiant machine ne suffit donc pas.

## 4. Verrou SNMP partagé par agent NovaStar — implémenté le 16 août 2026

1. Une voie FIFO commune identifie chaque agent par la paire normalisée
   `host:port SNMP`.
2. Les scans de deux identifiants machine visant la même paire sont strictement
   sérialisés, y compris après suppression puis recréation d'une configuration.
3. Le scan SNMP et la configuration SNMP des traps utilisent le même verrou.
4. Les opérations visant des paires différentes restent parallèles et la voie
   API reste indépendante.
5. La libération d'une ancienne opération ne peut pas supprimer la voie encore
   utilisée par les opérations en attente.
6. Les tests automatisés couvrent :
   - deux identifiants sur le même `host:port` ;
   - deux agents différents en parallèle ;
   - un scan et une configuration de traps concurrents sur le même agent.
7. Les journaux `NovaStarSnmpLock` exposent pour chaque passage : `lockKey`,
   `requestId`, `machineId`, `operation`, temps d'attente, durée de détention,
   profondeur d'attente, nombre actif et résultat.
8. La suite automatisée comporte désormais **75 tests réussis sur 75**.

## 5. Journaux roulants partagés — implémentés le 16 août 2026

Le backend et l'UI disposent de journaux roulants alignés, configurables dans
leurs `config.json`, vidés toutes les 30 secondes et immédiatement sur erreur.
Les erreurs du navigateur sont également envoyées au journal de l'UI. Les clics
utilisateur y sont journalisés de façon sémantique : rafraîchissement global ou
par carte, réduction/agrandissement, changement de page, actions de
configuration et autres boutons, sans enregistrer la valeur des formulaires.

## 6. Validation réseau du verrou SNMP partagé — terminée pour les scans le 16 août 2026

La capture `Debug/backend.log` confirme le scénario attendu :

- l'ancien identifiant `1786873015364` et le nouvel identifiant
  `1786877094376` visent tous deux `192.168.69.86:161` ;
- le nouveau scan a attendu `9116 ms` et a acquis le verrou 1 ms après la
  libération de l'ancien ;
- toutes les acquisitions observées ont `active:1`, sans aucun `active:2` ;
- les scans de `192.168.69.86:161` et `192.168.69.85:161` se sont chevauchés :
  les agents différents restent donc parallèles ;
- toutes les libérations observées ont `active:0` et `outcome:completed` ;
- aucune échéance `worker tick skipped` n'a été observée.

Le rapport détaillé est conservé dans `Debug/verification-verrou-snmp.md`. La
mise en concurrence réelle d'une opération `trap-configuration` avec un scan
n'apparaît pas dans cette capture ; ce cas reste couvert par le test automatisé.

Procédure conservée pour les validations ultérieures :

1. Reproduire une suppression/recréation ou deux demandes rapprochées visant le
   même `host:port`, puis filtrer `backend.log` sur `NovaStarSnmpLock`.
2. Pour une même valeur `lockKey`, vérifier l'alternance stricte :
   `lock acquired -> lock released -> lock acquired`.
3. Confirmer que chaque ligne `acquired` contient `"active":1` et qu'aucune
   ligne ne contient une valeur active supérieure à `1`.
4. Vérifier que le second `requestId` présente un `waitedMs` positif lorsqu'il a
   été demandé pendant le premier parcours.
5. Vérifier que `operation:"scan"` et `operation:"trap-configuration"` ne se
   chevauchent jamais pour une même clé.
6. Lancer simultanément des scans sur deux NovaStar différents et confirmer que
   leurs périodes entre `acquired` et `released` peuvent se chevaucher.
7. Contrôler `outcome:"completed"` ou `outcome:"failed"` et `heldMs` pour
   chaque `requestId`; une erreur doit toujours être suivie d'une libération.
8. Rechercher `worker tick skipped` pour compter les échéances périodiques
   ignorées parce qu'un scan précédent était toujours actif.
9. Sous `cmd.exe`, extraire les preuves dans un fichier sans interrompre les
   logs principaux :

   ```bat
   findstr /I /C:"NovaStarSnmpLock" /C:"worker tick skipped" logs\backend.log > logs\verification-verrou-snmp.txt
   ```

10. Confirmer l'absence totale de chevauchement sur une même clé avant de passer
    au point suivant. Cette validation terrain est réussie pour les scans.

## 7. Validation longue des workers — terminée hors cas SNMP-only le 16 août 2026

La capture longue valide les cycles multiples, le parallélisme entre agents,
l'absence d'empilement, les durées, la remise en route du worker après
réactivation et la réutilisation du snapshot SNMP par les cycles API. Le rapport
détaillé est dans `Debug/validation-todo-partie1-points1-2.md`.

Le cas SNMP-only désactivé n'était pas représenté dans la configuration.

## 8. Scan manuel hybride avec Scan SNMP désactivé — terminé le 16 août 2026

La capture complémentaire valide le scénario sur `192.168.69.86` :

- la configuration est enregistrée avec `snmpScanEnabled:false` à `11:49:32` ;
- le worker `.86` disparaît de la liste des workers planifiés ;
- l'ancien scan SNMP, commencé avant la désactivation, se termine normalement à
  `11:51:10.424` ;
- le scan manuel en attente exécute ensuite uniquement l'API de
  `11:51:10.469` à `11:51:10.644` ;
- aucune nouvelle demande `NovaStarSnmpLock` et aucun nouveau
  `SNMP scan started` ne sont émis pour ce scan ;
- un second scan manuel à `11:51:54` reste également API-only et se termine en
  224 ms ;
- `machines.json` confirme que Scan SNMP est resté désactivé pendant la capture.

## 9. Scan manuel SNMP-only avec Scan SNMP désactivé — terminé le 16 août 2026

La capture complémentaire valide le dernier scénario du contrôle Scan SNMP :

- la configuration de `192.168.69.86` est enregistrée en mode SNMP-only avec
  Scan SNMP désactivé à `11:54:13` ;
- le backend journalise immédiatement `NovaStar SNMP scan skipped by machine
  configuration` ;
- le scan manuel demandé à `11:54:14` est également ignoré côté SNMP ;
- la réponse arrive en `12.515 ms`, sans `NovaStarSnmpLock`, sans
  `SNMP scan started` et sans requête GET/SET ;
- la réponse de `74672` octets confirme que le dernier état disponible est
  renvoyé au lieu d'être remplacé par un état vide.

La validation des workers et de l'option **Scan SNMP** est maintenant complète
pour les modes hybride et SNMP-only, en périodique comme en manuel.

## 10. Configuration automatique des traps — validée le 16 août 2026

La configuration d'exploitation retenue est **SNMP + API**, avec **Scan SNMP**
désactivé et **Trap SNMP** activé. Dans cette combinaison, les scans périodiques
et manuels restent API-only ; SNMP sert uniquement à la configuration et à la
réception des traps.

La validation terrain confirme :

- les deux `SET` réussis sur `1.3.6.1.4.1.319.10.200.1` et
  `1.3.6.1.4.1.319.10.200.3` pour `.85` et `.86` ;
- la destination `192.168.69.22:1162` et l'activation à `1` ;
- le passage par le verrou partagé et la libération avec
  `outcome:"completed"` ;
- la relecture directe, backend arrêté, des deux OID sur `.85` et `.86` ;
- des scans manuels API-only sans `SNMP scan started` lorsque **Scan SNMP** est
  désactivé ;
- le contrôle négatif sur `.85` : aucun nouveau `SET` après désactivation de
  **Trap SNMP** ;
- la réactivation finale de **Trap SNMP** sur les deux NovaStar, confirmée dans
  `machines.json`.

## 11. Récepteur et chaîne logicielle des traps — validation réseau terminée le 16 août 2026

Les contrôles réalisables sans manipulation physique sont validés :

- démarrage avec `enabled:true`, `listening:true`, sans erreur, sur
  `0.0.0.0:1162` et annonce de `192.168.69.22:1162` ;
- écoute UDP locale confirmée par `Get-NetUDPEndpoint -LocalPort 1162` ;
- réponses authentifiées correctes de
  `GET /api/novastar-traps/status` et
  `GET /api/novastar-traps/events?limit=100` ;
- émission réelle par le simulateur d'une perte puis d'un rétablissement sur
  UDP, espacés de `253 ms` ;
- réception, décodage vers `input:I-1:1` et conservation des varbinds bruts ;
- rejet correct de la source locale inconnue avec `authorized:false`.

Les tests automatisés couvrent en complément la source autorisée, la
déduplication, le calcul de durée, la perte/récupération et l'effacement de
l'état temporaire au scan suivant. La validation terrain de bout en bout sur
traps réels est volontairement conservée en Partie 2 ; aucun mode spécial
d'autorisation du simulateur n'est ajouté au récepteur de production.

## 12. Statut Trap SNMP par NovaStar — terminé le 16 août 2026

Le backend configure désormais chaque NovaStar puis relit, dans la même section
protégée par le verrou partagé `host:port`, les OID de destination et
d'activation. `GET /api/novastar-traps/status` expose pour chaque machine :

- l'activation demandée dans la configuration ;
- l'état du récepteur backend ;
- la réussite des `SET` ;
- la destination et l'activation effectivement relues ;
- la date de vérification ;
- la date du dernier trap autorisé réellement reçu.

L'interface de configuration affiche séparément ces états. Une réussite des
`SET` ne suffit pas à déclarer la machine configurée si la relecture diffère.
Les communautés SNMP et autres secrets ne sont jamais exposés. Les tests
automatisés couvrent la confirmation, la divergence de relecture, l'horodatage
d'un trap autorisé et l'absence de secrets dans la réponse API.

## 13. Observation passive des traps — terminée le 16 août 2026

Le backend a fonctionné pendant `3 h 19 min` avec le récepteur actif et les deux
NovaStar `.85` et `.86` configurés, relus et confirmés. Les `6518` lignes de
`Backend.log` ne contiennent aucun warning ni aucune erreur liée aux traps.
Aucun trap spontané n'a été reçu ou rejeté : `events` est resté vide,
`lastTrapAt` est resté à `null` et le journal `novastar-traps.jsonl` n'a donc pas
été créé. La capture, l'identification des OID et la finalisation du décodeur
sont transférées en Partie 2, pendant des déconnexions physiques contrôlées.

# Partie 1 — Travaux réalisables avec un accès réseau uniquement

## 1. Préparer la campagne physique

1. Sélectionner les entrées et sorties pouvant être manipulées sans risque pour
   l'exploitation.
2. Relever leur machine, slot, port, libellé, état courant et état de référence.
3. Préparer une fiche de relevé avec les heures de débranchement, de réception
   du trap, de rétablissement et du scan suivant.
4. Choisir une durée de microcoupure courte et noter sa position par rapport aux
   scans API.
5. Vérifier que les journaux, API et écrans nécessaires seront accessibles
   pendant les manipulations.
6. Définir les critères d'arrêt en cas d'effet imprévu sur l'exploitation.

# Partie 2 — Travaux à réaliser à côté des NovaStar

## 1. Relever l'état initial

1. Vérifier physiquement l'identité du NovaStar, des cartes, des câbles et des
   ports sélectionnés pendant la préparation réseau.
2. Noter l'état initial dans l'interface, les observations API et SNMP, le rapport
   de divergences et l'heure exacte.
3. Confirmer que le récepteur de traps fonctionne et que **Trap SNMP** est activé
   sur la machine testée.
4. Confirmer la fréquence des scans API afin de pouvoir situer précisément la
   coupure, les traps et le scan suivant.

## 2. Tester une microcoupure d'entrée

1. Débrancher brièvement une entrée précisément identifiée.
2. La rebrancher avant le scan API suivant.
3. Confirmer la réception d'un trap de perte puis d'un trap de rétablissement.
4. Vérifier l'identification exacte du slot et de l'entrée.
5. Vérifier la présence de l'événement dans l'API et sa diffusion WebSocket.
6. Vérifier le cadre rouge sur le bon élément dans le monitoring et les maps.
7. Vérifier que l'état courant redevient correct après le rebranchement.
8. Vérifier que le cadre disparaît au scan API suivant sans nouvel incident.
9. Vérifier que l'historique conserve les deux heures et la durée calculée.
10. Archiver les varbinds bruts, OID, valeurs et encodages dans le journal de
    traps, y compris lorsque le format n'est pas encore reconnu.

## 3. Tester une microcoupure de sortie

1. Répéter le même scénario sur une sortie autorisée.
2. Confirmer les OID et valeurs perte/rétablissement réellement reçus.
3. Vérifier l'identification exacte de la carte et du port de sortie.
4. Vérifier la présence de l'événement dans l'API et sa diffusion WebSocket.
5. Vérifier le cadre rouge sur la bonne sortie dans le monitoring et les maps.
6. Vérifier le retour à l'état courant correct, la disparition du cadre au scan
   API suivant et la conservation de l'incident avec sa durée.
7. Archiver également les varbinds bruts et vérifier si le firmware utilise un
   format différent de celui observé pour les entrées.

## 4. Finaliser le décodeur à partir des observations physiques

1. Comparer les traps réels avec les formats déjà reconnus.
2. Confirmer les valeurs correspondant à la perte et au rétablissement.
3. Identifier les variantes selon le modèle et la version du firmware.
4. Déterminer si un même événement produit plusieurs traps.
5. Compléter le décodeur uniquement avec les significations confirmées.
6. Conserver et documenter les traps inconnus ou non exploitables.
7. Ajouter les tests automatisés correspondants puis rejouer toute la suite.

## 5. Tester les déconnexions contrôlées pour la réconciliation

1. Tester successivement :
   - perte d'une entrée ;
   - perte d'une sortie ;
   - indisponibilité de l'API ;
   - indisponibilité du SNMP ;
   - restauration de chaque situation.
2. Pour chaque scénario, relever :
   - observation API ;
   - observation SNMP ;
   - état résolu ;
   - divergences ;
   - délai de détection ;
   - délai de récupération.
3. Vérifier en particulier que la nuance API `2/3` reste disponible et que le
   SNMP fournit correctement l'état commun actif/inactif.

## 6. Tester les cas dégradés des traps

1. Perte sans trap de rétablissement.
2. Traps dupliqués et validation de leur déduplication.
3. Rafale de traps.
4. Plusieurs coupures successives sur le même port.
5. Coupures simultanées ou proches sur plusieurs ports.
6. Redémarrage du NovaStar.
7. Redémarrage du backend.
8. Interruption réseau entre le NovaStar et le backend.
9. Vérifier pour chaque cas l'absence de faux positif majeur, de doublon et de
   disparition prématurée d'un incident.

## 7. Arrêter la politique de réconciliation

1. Exploiter les résultats des tests réels pour valider ou ajuster :
   - la stratégie opérationnelle ;
   - le comportement avec une seule source disponible ;
   - le traitement des états absents ou invalides ;
   - le nombre de scans de confirmation de récupération ;
   - le délai avant retrait d'un élément absent de l'inventaire.
2. Documenter les divergences acceptées et leur justification.
3. Rejouer les scénarios physiques après tout changement significatif de règle.

## 8. Déployer définitivement et observer

1. Déployer la politique et le décodeur validés.
2. Activer durablement le récepteur Node et les options machine retenues.
3. Observer plusieurs cycles représentatifs de production.
4. Surveiller les erreurs, timeouts, traps inconnus, faux positifs et divergences
   récurrentes.
5. Ajuster si nécessaire la fréquence SNMP, la déduplication, la corrélation et
   la rétention des événements.
6. Documenter la configuration finale et la procédure d'exploitation.

## Critères de clôture

Le travail pourra être considéré comme terminé lorsque :

1. les workers SNMP ont été validés en parallèle sans chevauchement sur une même
   machine ;
2. **Scan SNMP** fonctionne sur la cible pour les cycles périodiques et manuels ;
3. **Trap SNMP** fonctionne indépendamment de **Scan SNMP** ;
4. chaque NovaStar attendu est configuré vers la bonne destination de traps ;
5. le backend reçoit effectivement les traps réels ;
6. les formats perte/rétablissement sont confirmés ;
7. une microcoupure physique entièrement comprise entre deux scans est détectée ;
8. le bon élément est encadré puis le cadre disparaît au scan suivant ;
9. l'incident reste journalisé avec ses heures et sa durée ;
10. les snapshots et la politique de réconciliation sont validés sur la cible ;
11. les cas dégradés essentiels ne produisent pas de faux positifs majeurs ;
12. la configuration et la procédure d'exploitation finales sont documentées.

# Partie 3 — Travaux reportés

## 1. Valider les snapshots et la réconciliation I/O

**Décision du 16 août 2026 : ce travail est reporté.** L'exploitation retenue
utilise l'API seule pour les scans périodiques et manuels, avec **Scan SNMP**
désactivé et **Trap SNMP** activé indépendamment. La réconciliation API/SNMP
n'est donc plus bloquante pour la mise en service de ce mode.

Ce travail devra être repris avant toute réactivation du scan SNMP ou du mode
hybride. Il reste alors à exclure les receiving cards du rapport inter-sources,
à classifier les champs propres à une seule source et à expliquer les quatre
écarts d'état observés sur `.85` (`O-12:2/4/6/7`).

**État après analyse des trois snapshots : non validé.** Les identifiants des
I/O principales sont cohérents et aucune réponse `ERROR:` ne crée d'entité,
mais le nombre de cartes de réception fluctue (`32/32/18` sur `.85` et
`32/21/32` sur `.86`) à la suite de timeouts. Les rapports conservent 116 à 121
divergences, dont quatre divergences d'état stables sur `.85`. Voir le rapport
`Debug/validation-todo-partie1-points1-2.md`.

**Contrôle complémentaire du 16 août 2026 : collecte stabilisée, réconciliation
non validée.** Les scans manuels ont parcouru 32 receiving cards sur chaque
NovaStar sans warning ni erreur. Le HAR fournit sept snapshots complets ; le
dernier confirme l'inventaire attendu (`I-1`, `I-3`, `O-11`, `O-12`) et 32
receiving cards sur les deux machines. Il confirme aussi 32 divergences
artificielles `missing-observation` par machine, car les receiving cards propres
au SNMP sont encore comparées à l'API. `.85` conserve par ailleurs quatre écarts
d'état réels sur `O-12:2/4/6/7`, tandis que `.86` n'en présente aucun. Voir
`Debug/validation-snapshots-har-2026-08-16.md`.

1. Collecter plusieurs snapshots API, SNMP et hybrides stabilisés.
2. Vérifier sur la cible attendue la présence de :
   - `I-1` avec 4 interfaces ;
   - `I-3` avec 4 interfaces ;
   - `O-11` avec 16 ports ;
   - `O-12` avec 16 ports.
3. Confirmer que les slots vides et les valeurs NovaStar commençant par
   `ERROR:` ne créent aucun équipement valide.
4. Confirmer que les identifiants canoniques API et SNMP correspondent.
5. Vérifier que les codes API actifs `2` et `3` sont comparés à l'état SNMP actif
   sans fausse divergence.
6. Vérifier que les receiving cards restent disponibles dans les détails sans
   être affichées ni comparées comme des équipements supplémentaires.
7. Examiner le rapport de divergences et conserver les logs et snapshots de
   toute valeur firmware non encore rencontrée.
8. Déterminer si les divergences restantes sont réelles, acceptables ou dues à
   une règle de réconciliation à ajuster.
