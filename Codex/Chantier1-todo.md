# Chantier 1 — Fiabilisation de la récupération des états I/O

## Avancement de la phase A

1. Formaliser les identifiants canoniques — **terminé**.
2. Séparer inventaire et observations — **terminé**.
3. Ajouter un verrou SNMP par équipement — **mis de côté sous conditions**.
4. Collecter API et SNMP — **implémenté et testé ; snapshot cible à valider après déploiement**.
5. Construire le rapport de divergences — **terminé**.
6. Faire des tests de déconnexion contrôlée — **à faire**.
7. Fixer la politique de réconciliation — **implémentée, à valider**.
8. Déployer et observer — **à faire**.

## Conclusions SNMP validées les 13 et 15 août 2026

### Inputs

Le fonctionnement est suffisamment établi pour corriger la collecte :

- les positions physiques des slots commencent à `0` ;
- les cartes présentes sur `192.168.69.86` sont `0 -> I-1` et `2 -> I-3` ;
- les slots vides répondent notamment `ERROR: the slot is empty` et ne doivent jamais être considérés comme des cartes valides ;
- `I-1` possède les identifiants métier globaux de source `0` à `3` ;
- `I-3` possède les identifiants métier globaux de source `4` à `7` ;
- le sélecteur de source `.20.4` attend l'identifiant métier global sous forme de chaîne (`"0"`, `"4"`, etc.), pas un objet JSON ;
- un sélecteur accepté par le `SET` n'est pas nécessairement valide : les `GET` associés doivent être contrôlés pour détecter `BizIdError` et les autres réponses `ERROR:`.

Exemples validés :

- slot `0`, source `0` : état `1`, `1920 x 1080`, `60 Hz`, type `4` ;
- slot `2`, source globale `4` : état `1`, `1920 x 1080`, `60 Hz`, type `4`.

### Outputs

L'inventaire des cartes est établi :

- slot physique `10 -> O-11`, numéro de série `00306701000009d6`, 16 ports ;
- slot physique `11 -> O-12`, numéro de série `17021300cac40000`, 16 ports ;
- les slots doivent être parcourus par position physique, dès `0`, en ignorant les réponses `ERROR:`.

La lecture opérationnelle des ports est maintenant comprise :

- `.30.4` exige exactement les clés JSON `outputSlotId`, `netPortId` et `recvCardId` ;
- les clés historiques `outputSlotid` et `netportId` étaient ignorées par le firmware et produisaient des valeurs par défaut ;
- `outputSlotId` utilise la position physique brute (`10` pour `O-11`) ;
- `netPortId` commence à `0` et le numéro affiché vaut `netPortId + 1` ;
- `recvCardId: 0` fournit le résumé opérationnel validé ;
- le résumé JSON `.30.6` est plus fiable que les champs individuels `.30.7.x` sur ce firmware ;
- `tempStatus = 0` correspond à un output actif et `tempStatus = 2` à un output inactif ;
- cette règle reproduit les frontières API observées sur `O-11` et `O-12` ;
- SNMP ne reproduit pas la nuance API entre les codes actifs `2` et `3` : ils doivent être comparés sur l'état commun `active` ;
- `.30.5.5` n'est pas exposé par ce firmware (`noSuchName`).

## Travail réalisé dans cette évolution

### 1. Collecte SNMP des inputs — terminé

- Le balayage commence à la position physique `0` et accepte les slots non contigus.
- Un slot d'entrée n'est retenu que si sa série est renseignée et son nombre de sources strictement positif.
- Toutes les valeurs NovaStar commençant par `ERROR:` sont rejetées.
- Les sources utilisent un identifiant métier global envoyé comme chaîne simple dans `.20.4`.
- Les identifiants bruts restent séparés des libellés humains `I-x.y`.
- Aucun `GET` de contexte n'est exécuté après l'échec d'un `SET`.
- Les lectures associées aux sélecteurs sont séquentielles.
- Des tests couvrent les slots non contigus, les sélecteurs et les erreurs applicatives.

### 2. Collecte SNMP des outputs — terminé avec granularité documentée

- Le balayage physique commence à `0` et retient uniquement les slots ayant une série et des ports.
- Le sélecteur utilise la casse correcte `outputSlotId/netPortId/recvCardId`.
- Les ports sont parcourus de `0` à `netPortCount - 1` avec `recvCardId: 0`.
- Le résumé `.30.6` est parsé et fournit un champ canonique `status` actif/inactif à partir de `tempStatus`.
- Chaque port n'effectue plus qu'un seul `GET` sur `.30.6` après son `SET` ; les trois lectures `.30.5.x` redondantes ont été supprimées pour raccourcir le scan.
- Les autres valeurs de `tempStatus`, les JSON invalides, les erreurs et les timeouts produisent `unknown`.
- Les OID instables ou non exposés ne sont plus nécessaires à la décision opérationnelle.
- La nuance API `2/3` reste disponible dans l'observation API, mais n'est pas inventée côté SNMP.

### 3. Mapping inter-sources et rapport de divergences — terminé pour les I/O

- Les positions physiques brutes produisent les mêmes `entityId` côté API et SNMP (`I-1`, `I-3`, `O-11`, `O-12`).
- Les ports et sources utilisent leurs numéros humains dans les identifiants canoniques.
- Pour un output, le rapport compare uniquement le champ opérationnel commun `status`.
- Les codes API `2` et `3` sont comparables à SNMP `1` comme états actifs, sans fausse divergence.
- Lorsque les deux sources sont opérationnellement d'accord, l'observation API reste sélectionnée pour conserver sa nuance détaillée.
- Les champs propres à SNMP ne génèrent pas de `missing-field` artificiel sur les outputs.
- Les écrans API et SNMP restent volontairement distincts tant que leur équivalence générale n'est pas validée.

Validation automatisée : **68 tests réussis sur 68**, dont les scénarios SNMP
I/O, hybrides, traps, workers indépendants, fréquence minimale et respect de
l'option **Scan SNMP** lors des scans manuels.

## Limite de performance constatée le 15 août 2026

La collecte de chaque port de sortie a été réduite à la séquence minimale :

```text
SET .30.4
GET .30.6
```

Les lectures redondantes `.30.5.1`, `.30.5.3` et `.30.5.4` ne sont plus exécutées.
Malgré cette optimisation, le NovaStar testé répond fréquemment après environ
2,5 secondes aussi bien au `SET` qu'au `GET`, probablement après expiration de la
première tentative. Un port peut donc nécessiter environ 5 secondes et un scan
complet de 32 ports entre 2 min 30 et 3 minutes.

Les scans d'une même machine ne se chevauchent pas : une échéance périodique
survenant pendant un scan réutilise le travail en cours. Elle ne crée pas un
second parcours concurrent des sélecteurs.

### Planification mise en œuvre le 16 août 2026

- L'API reste la source de suivi fréquent.
- Le scan SNMP utilise une fréquence indépendante par machine : 10 minutes par
  défaut, avec un minimum de 4 minutes.
- Un worker logique est créé pour chaque NovaStar dont **Scan SNMP** est activé.
  Les workers de machines différentes peuvent travailler en parallèle.
- Un worker ne conserve jamais plusieurs scans actifs pour sa machine et tous
  les appels restent orchestrés par `MonitoringService.scanMachine()`.
- Le parcours intérieur reste impérativement séquentiel :
  `SET -> GET associés -> sélecteur suivant`.
- Pour une machine hybride, les scans API fréquents n'exécutent pas de SNMP et
  réutilisent le dernier snapshot SNMP jusqu'au passage suivant du worker.
- La case **Scan SNMP**, placée au-dessus de « Paramètres avancés », contrôle les
  scans SNMP périodiques et manuels.
- Si **Scan SNMP** est désactivé sur une machine hybride, un scan manuel ne lance
  que l'API. Sur une machine SNMP-only, aucune requête SNMP n'est envoyée et le
  dernier état disponible est conservé.

## Travail restant

### Validation cible du point 4

- Déployer le paquet 2MC.
- Lancer plusieurs scans SNMP, API et hybrides sur la cible.
- Vérifier que les inventaires présentent `I-1`, `I-3`, `O-11` et `O-12` avec respectivement 4, 4, 16 et 16 interfaces.
- Vérifier la forte diminution des divergences artificielles.
- Conserver les logs et snapshots en cas de valeur firmware non encore rencontrée.
- Mesurer la durée réelle d'un scan complet après chaque évolution de la
  planification SNMP.

### 4. Faire les tests de déconnexion contrôlée (point 6)

Tester successivement une perte d'entrée, une perte de sortie, l'indisponibilité de l'API, l'indisponibilité de SNMP et leur restauration. Pour chaque scénario, relever les deux observations, les divergences, l'état résolu et les délais de détection/récupération.

### 5. Valider la politique de réconciliation (point 7)

À partir des essais réels, arrêter les choix concernant la stratégie opérationnelle, la source unique disponible, les états invalides ou absents et les nombres de scans de confirmation. L'API reste la source de la nuance détaillée `2/3`, tandis que SNMP fournit l'état commun actif/inactif.

### 6. Déployer et observer (point 8)

Déployer la politique retenue, observer plusieurs cycles représentatifs, analyser les divergences récurrentes et documenter les écarts acceptés.

## Condition concernant le verrou SNMP (point 3)

Aucun verrou complexe n'est nécessaire tant que :

- une seule configuration NovaStar pointe vers une même paire `IP:port SNMP` ;
- toutes les collectes SNMP de production proviennent uniquement de `TAV_Monitoring_Backend` ;
- elles sont orchestrées par `DeviceMonitor.js` via `MonitoringService.scanMachine()` ;
- aucun second processus ou service ne manipule les sélecteurs ;
- chaque parcours reste strictement séquentiel : `SET -> GET associés -> sélecteur suivant`.

Les commandes Cygwin constituent temporairement un second utilisateur des sélecteurs. Le backend doit donc être arrêté pendant ces diagnostics manuels.

Si une condition change, arrêter l'évolution concernée et concevoir d'abord un verrou partagé par agent NovaStar, identifié par `host:port`.

## Ordre recommandé à la reprise

1. Déployer la nouvelle planification sur la cible.
2. Vérifier en conditions réelles que plusieurs workers NovaStar avancent en
   parallèle sans chevauchement pour une même machine.
3. Valider séparément **Scan SNMP** activé et désactivé, sur cycle périodique et
   scan manuel.
4. Valider les snapshots SNMP/API/hybrides et le rapport de divergences.
5. Réaliser les tests contrôlés du point 6.
6. Valider la politique du point 7.
7. Déployer définitivement et observer selon le point 8.

La détection des microcoupures par traps SNMP appartient au chantier 2.
