# Récupération et interprétation des I/O NovaStar en SNMP

## Objet

Ce document décrit la méthode validée sur le NovaStar `192.168.69.86` le 15 août 2026 pour :

- inventorier les cartes d’entrée et de sortie ;
- sélectionner leurs interfaces avec les OID d’écriture ;
- lire et interpréter leurs états ;
- convertir les identifiants SNMP internes en libellés affichables ;
- détecter les réponses NovaStar invalides, même lorsque la requête SNMP elle-même réussit.

Les constats sont propres à la MIB et au firmware testés. Toute évolution de firmware doit entraîner une nouvelle validation sur la cible.

## Contraintes générales

### Accès SNMP

Sur l’équipement testé :

- SNMP v2c fonctionne ;
- la communauté de lecture est `public` ;
- la communauté d’écriture est également `public` ;
- le port SNMP est `161`.

Ces valeurs restent configurables par machine. Elles ne doivent pas être codées en dur dans le connecteur.

### Sélecteurs et concurrence

Les données détaillées sont exposées derrière des OID servant de sélecteurs globaux. Une lecture doit toujours respecter cet ordre :

```text
SET du sélecteur
GET immédiatement associés
SET du sélecteur suivant
```

Les parcours doivent être strictement séquentiels. Il ne faut pas paralléliser les sélections ou leurs lectures sur un même agent `host:port`.

En production, toutes les collectes NovaStar doivent rester orchestrées par `DeviceMonitor.js` et déclenchées via `MonitoringService.scanMachine()`. Pendant un diagnostic manuel avec Cygwin, arrêter le backend afin qu’il ne modifie pas les mêmes sélecteurs entre un `SET` et ses `GET`.

### Un SET réussi ne valide pas la sélection

Le NovaStar peut accepter le `SET`, puis retourner dans la valeur d’un `GET` :

```text
ERROR: the slot is empty
ERROR: BizIdError
```

Ces réponses sont des erreurs applicatives transportées dans une réponse SNMP techniquement réussie. Toute valeur textuelle commençant par `ERROR:` doit être considérée comme invalide.

Si le `SET` échoue ou expire, ne pas lancer les `GET` : ils pourraient lire le contexte laissé par la sélection précédente.

## OID des entrées

| Fonction | OID | Type |
|---|---|---|
| Sélection du slot d’entrée | `1.3.6.1.4.1.319.10.10.20.0` | Integer |
| Nombre de slots d’entrée | `1.3.6.1.4.1.319.10.10.20.1` | Integer |
| État du slot sélectionné | `1.3.6.1.4.1.319.10.10.20.2.1` | Integer ou erreur textuelle |
| Firmware du slot | `1.3.6.1.4.1.319.10.10.20.2.2` | OctetString |
| Numéro de série du slot | `1.3.6.1.4.1.319.10.10.20.2.3` | OctetString |
| Nombre de sources du slot | `1.3.6.1.4.1.319.10.10.20.2.4` | Integer ou erreur textuelle |
| Résumé du slot | `1.3.6.1.4.1.319.10.10.20.3` | OctetString |
| Sélection d’une source | `1.3.6.1.4.1.319.10.10.20.4` | OctetString |
| État du signal | `1.3.6.1.4.1.319.10.10.20.5.1` | Integer |
| Largeur | `1.3.6.1.4.1.319.10.10.20.5.2` | Integer |
| Hauteur | `1.3.6.1.4.1.319.10.10.20.5.3` | Integer |
| Fréquence | `1.3.6.1.4.1.319.10.10.20.5.4` | Float |
| Type de source | `1.3.6.1.4.1.319.10.10.20.5.5` | Integer |

## Inventaire des cartes d’entrée

Les slots physiques sont indexés à partir de `0` et peuvent être non contigus.

Algorithme recommandé :

1. Lire le nombre de cartes présentes avec `.20.1`.
2. Parcourir les positions physiques de `0` jusqu’à la limite configurée, par défaut `31`.
3. Pour chaque position, écrire l’identifiant entier dans `.20.0`.
4. Lire immédiatement `.20.2.1`, `.20.2.3` et `.20.2.4`.
5. Rejeter le slot si un champ contient `ERROR:`, si le numéro de série est vide ou si le nombre de sources n’est pas strictement positif.
6. Conserver les slots valides jusqu’à atteindre le nombre annoncé par `.20.1` ou la limite de balayage.

Sur l’équipement validé :

| Slot SNMP | Libellé affiché | Série | Sources |
|---:|---|---|---:|
| `0` | `I-1` | `00306901000004f8` | 4 |
| `2` | `I-3` | `00306901000004d0` | 4 |

Le libellé humain du slot est obtenu avec :

```text
I-(slotId SNMP + 1)
```

Exemple de sélection :

```sh
snmpset -v2c -c public 192.168.69.86 \
  1.3.6.1.4.1.319.10.10.20.0 i 2
```

## Sélection et lecture des sources d’entrée

Le sélecteur `.20.4` n’attend pas un objet JSON. Il attend l’identifiant métier global de la source sous forme de chaîne.

Format correct :

```text
"0"
"1"
"4"
```

Format incorrect :

```json
{"inputSlotId":2,"sourceId":0}
```

Les identifiants métier des sources sont globaux et continus sur les cartes d’entrée présentes, classées par position physique :

| Carte | Sources locales affichées | Identifiants métier SNMP validés |
|---|---|---|
| `I-1` | 1 à 4 | `0` à `3` |
| `I-3` | 1 à 4 | `4` à `7` |

L’identifiant global peut être construit par cumul du nombre de sources des cartes valides précédentes :

```text
globalSourceId = somme(sourceCount des slots précédents) + localSourceIndex
```

`localSourceIndex` commence à `0`. Le numéro affiché vaut `localSourceIndex + 1`.

Séquence de lecture :

1. Sélectionner le slot physique dans `.20.0`.
2. Sélectionner la source globale dans `.20.4` avec une chaîne simple.
3. Lire immédiatement `.20.5.1` à `.20.5.5`.
4. Rejeter l’observation si un champ contient `ERROR:` ou si la sélection a échoué.

Exemple validé pour `I-3.1` :

```sh
snmpset -v2c -c public 192.168.69.86 \
  1.3.6.1.4.1.319.10.10.20.0 i 2

snmpset -v2c -c public 192.168.69.86 \
  1.3.6.1.4.1.319.10.10.20.4 s "4"

snmpget -v2c -c public 192.168.69.86 \
  1.3.6.1.4.1.319.10.10.20.5.1 \
  1.3.6.1.4.1.319.10.10.20.5.2 \
  1.3.6.1.4.1.319.10.10.20.5.3 \
  1.3.6.1.4.1.319.10.10.20.5.4 \
  1.3.6.1.4.1.319.10.10.20.5.5
```

Résultat observé : état `1`, `1920 × 1080`, `60 Hz`, type `4`.

### Interprétation des inputs

- état `1` : signal présent/valide sur les cas testés ;
- état `0` : absence de signal sur les cas attendus, à conserver comme état opérationnel et non comme erreur SNMP ;
- `BizIdError`, autre `ERROR:`, timeout ou type incohérent : observation `unknown`/invalide ;
- largeur, hauteur et fréquence complètent l’observation mais ne doivent pas rendre un état `0` artificiellement valide.

## OID des sorties

| Fonction | OID | Type |
|---|---|---|
| Sélection du slot de sortie | `1.3.6.1.4.1.319.10.10.30.0` | Integer |
| Nombre de slots de sortie | `1.3.6.1.4.1.319.10.10.30.1` | Integer |
| État du slot | `1.3.6.1.4.1.319.10.10.30.2.1` | Integer ou erreur textuelle |
| Firmware du slot | `1.3.6.1.4.1.319.10.10.30.2.2` | OctetString |
| Numéro de série du slot | `1.3.6.1.4.1.319.10.10.30.2.3` | OctetString |
| Nombre de ports | `1.3.6.1.4.1.319.10.10.30.2.4` | Integer ou erreur textuelle |
| Résumé du slot | `1.3.6.1.4.1.319.10.10.30.3` | OctetString |
| Sélection slot/port/receiving card | `1.3.6.1.4.1.319.10.10.30.4` | OctetString JSON |
| État du port | `1.3.6.1.4.1.319.10.10.30.5.1` | Integer |
| État du port de secours | `1.3.6.1.4.1.319.10.10.30.5.3` | Integer |
| État du lien de secours | `1.3.6.1.4.1.319.10.10.30.5.4` | Integer |
| Résumé de receiving card | `1.3.6.1.4.1.319.10.10.30.6` | OctetString JSON |
| Champs individuels de receiving card | `1.3.6.1.4.1.319.10.10.30.7.x` | Variables |

L’OID `.30.5.5` annoncé dans la MIB n’est pas exposé par le firmware testé et retourne `noSuchName`.

## Inventaire des cartes de sortie

Comme pour les entrées, les positions physiques commencent à `0` et les cartes ne sont pas nécessairement contiguës.

Algorithme recommandé :

1. Lire le nombre de cartes de sortie avec `.30.1`.
2. Balayer les positions physiques de `0` à la limite configurée.
3. Écrire chaque position dans `.30.0` avec le type Integer.
4. Lire `.30.2.1`, `.30.2.3` et `.30.2.4`.
5. Rejeter les réponses `ERROR:`, les séries vides et les slots dont le nombre de ports est nul.
6. Arrêter après avoir trouvé le nombre de cartes annoncé ou atteint la limite.

Sur l’équipement validé :

| Slot SNMP | Libellé affiché | Série | Ports |
|---:|---|---|---:|
| `10` | `O-11` | `00306701000009d6` | 16 |
| `11` | `O-12` | `17021300cac40000` | 16 |

Le libellé humain est :

```text
O-(slotId SNMP + 1)
```

## Sélection des ports de sortie

Le sélecteur `.30.4` attend une chaîne contenant un objet JSON. La casse des clés est impérative.

Format correct :

```json
{"outputSlotId":10,"netPortId":0,"recvCardId":0}
```

Formats incorrects ayant provoqué des valeurs par défaut et des `BizIdError` :

```json
{"outputSlotid":10,"netportId":0,"recvCardId":0}
{"slotId":10,"netPortId":0,"recvCardId":0}
```

Les indexations validées sont :

- `outputSlotId` : position physique brute, par exemple `10` pour `O-11` ;
- `netPortId` : index interne de `0` à `netPortCount - 1` ;
- `recvCardId` : `0` pour la lecture opérationnelle validée.

Le port affiché vaut `netPortId + 1`.

Après chaque `SET` réussi, la collecte de production lit uniquement `.30.6`.
Ce résumé est la source la plus fiable sur le firmware testé et contient déjà
`workStatus`, `tempStatus` et `voltStatus`. Les lectures séparées `.30.5.1`,
`.30.5.3` et `.30.5.4` sont donc volontairement omises afin de réduire le nombre
de requêtes et la durée du scan.

Exemple :

```sh
snmpset -v2c -c public 192.168.69.86 \
  1.3.6.1.4.1.319.10.10.30.4 \
  s '{"outputSlotId":10,"netPortId":0,"recvCardId":0}'

snmpget -v2c -c public 192.168.69.86 \
  1.3.6.1.4.1.319.10.10.30.6
```

Résumé observé :

```json
{
  "fpgaVersion": "V0.0.0.0",
  "mcuVersion": "V0.0.0.0",
  "temp": 0,
  "tempMax": 70,
  "tempStatus": 0,
  "volt": 0,
  "voltStatus": 2,
  "workStatus": 1
}
```

## Interprétation des outputs

Sur le firmware validé, `.30.5.1`, `.30.5.3`, `.30.5.4` et `workStatus` ne permettent pas de distinguer tous les états visibles dans l’API. Ils sont notamment restés à `1` pour des ports API actifs et inactifs.

La corrélation opérationnelle validée utilise `tempStatus` dans le résumé `.30.6` :

| `tempStatus` SNMP | Interprétation opérationnelle |
|---:|---|
| `0` | output actif / chaîne de réception présente |
| `2` | output inactif / chaîne absente ou indisponible |
| autre | état inconnu à valider |

Cette interprétation ne signifie pas nécessairement que la température elle-même est en défaut. Sur ce firmware, `tempStatus` est le champ qui reproduit de manière stable la présence ou l’absence opérationnelle observée dans l’API.

Validations effectuées :

- `O-11`, ports 1 à 10 : API `2` ou `3`, SNMP `tempStatus = 0` ;
- `O-11`, ports 11 à 16 : API `0`, SNMP `tempStatus = 2` ;
- `O-12`, port 12 : API `3`, SNMP `tempStatus = 0` ;
- `O-12`, port 13 : API `0`, SNMP `tempStatus = 2`.

### Limite de granularité

L’API intégrée distingue les états `2` et `3`. Les champs SNMP testés ne permettent pas de retrouver cette nuance :

- port API `3` et port API `2` ont retourné les mêmes valeurs `.30.5.x` ;
- leurs résumés `.30.6` ont été identiques ;
- parcourir `recvCardId` de `0` à `5` n’a révélé aucune différence.

Pour la réconciliation :

- comparer API et SNMP sur une dimension commune `active/inactive` ;
- normaliser API `2` et `3` vers `active` pour cette comparaison ;
- normaliser API `0` vers `inactive` ;
- ne pas produire une divergence simplement parce que SNMP ne représente pas la nuance API `2/3` ;
- conserver l’API comme source de la nuance détaillée lorsque celle-ci est nécessaire à l’affichage ou à l’alarme.

## Gestion des erreurs et robustesse

Chaque lecture doit distinguer :

- erreur de transport : timeout, socket, paquet SNMP invalide ;
- erreur d’accès SNMP : `NoAccess`, mauvaise communauté ;
- OID absent : `noSuchName`, `NoSuchObject`, `NoSuchInstance` ;
- erreur NovaStar dans une valeur : texte commençant par `ERROR:` ;
- JSON de résumé invalide ou incomplet ;
- valeur métier inconnue.

Règles recommandées :

1. Ne pas poursuivre les `GET` après l’échec du `SET`.
2. Ne pas réutiliser implicitement les données du contexte précédent.
3. Marquer le champ concerné `unknown` plutôt que de fabriquer un état normal.
4. Continuer la collecte des autres slots ou ports lorsque cela ne compromet pas la cohérence du sélecteur.
5. Journaliser le sélecteur, l’OID et la classe d’erreur, sans exposer la communauté SNMP.
6. Utiliser des timeouts et retries raisonnables ; les tests manuels stables ont utilisé jusqu’à `-t 5 -r 2`.
7. Conserver la séquence complète d’un équipement dans une seule orchestration séquentielle.

## Algorithme synthétique

```text
lire inputSlotCount
balayer les positions physiques à partir de 0
  SET inputSlotSelector
  si SET réussi : GET champs du slot
  si slot valide :
    calculer les identifiants globaux de ses sources
    pour chaque source locale :
      SET inputSourceSelector avec l’identifiant global sous forme de chaîne
      si SET réussi : GET champs de la source

lire outputSlotCount
balayer les positions physiques à partir de 0
  SET outputSlotSelector
  si SET réussi : GET champs du slot
  si slot valide et netPortCount > 0 :
    pour netPortId de 0 à netPortCount - 1
      SET .30.4 avec outputSlotId/netPortId/recvCardId=0
      si SET réussi : GET résumé .30.6
      parser le JSON
      tempStatus 0 => actif
      tempStatus 2 => inactif
      autre/erreur => unknown
```

## Points à revalider sur un autre modèle ou firmware

- limite maximale des positions de slots ;
- continuité des identifiants globaux des sources d’entrée ;
- signification exacte des codes d’état d’entrée ;
- présence et utilité de `.30.5.5` ;
- corrélation `tempStatus 0/2` avec l’état opérationnel des outputs ;
- possibilité éventuelle de distinguer les nuances API `2/3` ;
- nombre et indexation des receiving cards réellement exposées.
