# Récupération des informations NovaStar

## Objectif

SNMPViewer peut interroger un équipement NovaStar H selon trois modes :

- `SNMP` : lecture des informations exposées par la MIB NovaStar ;
- `API` : lecture de l'API HTTP interne de l'équipement ;
- `SNMP + API` : interrogation simultanée des deux sources puis fusion par domaine fonctionnel.

Le mode hybride ne donne pas une priorité globale à une seule technologie. Chaque source est utilisée pour les données qu'elle décrit le mieux.

## Priorités en mode SNMP + API

| Domaine | Source prioritaire | Source de secours | Principe |
|---|---|---|---|
| Contrôleur | SNMP | API | Le SNMP expose les informations système et les états du contrôleur les plus complets. |
| Slots d'entrée | API | SNMP | L'API fournit l'inventaire des cartes réellement présentes et leurs interfaces. |
| Slots de sortie | API | SNMP | L'API fournit l'inventaire réel des cartes et des ports émetteurs. |
| Écrans | SNMP | API | Le SNMP expose les écrans adressables. L'objet `Device` de l'API ne représente qu'une résolution courante. |
| Receiving cards | SNMP | Aucun | Les receiving cards nécessitent les sélecteurs SNMP et possèdent des mesures propres : température, tension et versions. |
| Ports de sortie | API | Aucun | Les statuts `senderInterfaceStatus` de l'API décrivent les ports de sortie, pas des receiving cards. |
| MVR, USB, ventilateurs et alimentations | API | Aucun | Ces informations matérielles sont fournies directement par `readDetail` et `readVideoServerInfo`. |

Lorsqu'une collection API prioritaire est disponible, elle constitue l'inventaire de référence. Les éléments SNMP non présents dans cet inventaire ne sont pas ajoutés, ce qui évite les doublons tels que `1` avec `I-1` ou `O-11`.

Les champs manquants d'un slot API peuvent être complétés avec le slot SNMP correspondant lorsque leurs identifiants normalisés concordent.

## Déroulement d'un scan

### Mode SNMP

1. Création d'une session SNMP v2c.
2. Lecture du contrôleur.
3. Lecture du nombre de slots d'entrée puis parcours de chaque slot.
4. Lecture des sources de chaque slot d'entrée.
5. Lecture du nombre de slots de sortie puis parcours de chaque slot.
6. Lecture des écrans.
7. Lecture optionnelle des receiving cards après positionnement du sélecteur correspondant.
8. Fermeture des sessions utilisées par chaque opération.

### Mode API

1. Authentification HTTP auprès de l'équipement.
2. Conservation du token de session.
3. Lecture du détail de l'équipement.
4. Lecture du genlock et des informations du serveur vidéo lorsqu'elles sont disponibles.
5. Normalisation de la réponse dans le même format que les données SNMP.
6. Séparation explicite des ports de sortie dans `outputPorts`.

### Mode SNMP + API

1. Les lectures SNMP et API sont lancées en parallèle.
2. Une panne d'une source n'empêche pas l'utilisation de l'autre.
3. Si les deux sources échouent, la requête de monitoring retourne une erreur.
4. Les résultats sont assemblés selon la table de priorité par domaine.
5. `sourceStatus` indique si chaque source a répondu et `sourceErrors` conserve les erreurs éventuelles.

## Structure normalisée

Chaque scan renvoie un objet contenant notamment :

- `controller` : champs du contrôleur ;
- `inputSlots` : collection des cartes d'entrée ;
- `outputSlots` : collection des cartes de sortie ;
- `screens` : collection des écrans ;
- `outputPorts` : ports de sortie obtenus par l'API ;
- `receivingCards` : receiving cards obtenues par SNMP ;
- `mvrCards` : cartes MVR et interfaces MVR/HDMI obtenues par l'API ;
- `mvrVideo` : état et URL des flux vidéo MVR ;
- `usbPorts` : état individuel des ports USB ;
- `fans` : état individuel des ventilateurs ;
- `powerSupplies` : état individuel des alimentations ;
- `source` : `snmp`, `api` ou `snmp+api` ;
- `timestamp` : date du scan.

Un champ normalisé possède généralement cette forme :

```json
{
  "ok": true,
  "value": "valeur",
  "oid": "OID éventuel",
  "error": "erreur éventuelle"
}
```

La propriété `ok` sert au calcul de l'état de monitoring. Une valeur absente ou non applicable ne doit pas nécessairement être considérée comme une panne.

## Ports de sortie et receiving cards

Ces deux notions doivent rester séparées :

- un port de sortie API représente une interface émettrice d'une carte de sortie ;
- une receiving card SNMP représente une carte de réception adressée derrière un slot et un port.

Un port API inactif est affiché avec un état neutre. Il ne provoque pas à lui seul l'état global `Problème`, car un port inutilisé peut légitimement être sans lien. Un port présentant un avertissement explicite peut en revanche signaler un problème.

## Sélecteurs SNMP des receiving cards

La lecture des receiving cards est contextuelle. Le sélecteur `.30.4` doit être positionné avant de lire `.30.6` et `.30.7.x`.

Une réponse `ERROR: BizIdError` indique généralement que le contexte sélectionné ne correspond pas à une receiving card valide. Elle ne prouve pas que l'OID est absent. Il faut vérifier :

- le slot sélectionné ;
- le numéro du port ;
- le numéro de receiving card ;
- la casse exacte des clés JSON du sélecteur ;
- la base des index, zéro ou un selon le protocole réel de l'équipement.

## Classes JavaScript utilisées

### `classes/SnmpLib.js`

La classe `SNMPConnector` assure les communications SNMP.

Fonctions principales :

- `createSession(community)` : ouvre une session SNMP v2c ;
- `get(oid)` : lit un OID ;
- `set(oid, type, value)` : écrit un sélecteur ou une valeur ;
- `readFields(definitions)` : lit et normalise une liste de champs ;
- `readController()` : récupère les informations du contrôleur ;
- `readInputSlots(maxSlots)` : parcourt les cartes d'entrée ;
- `readInputSources(options)` : parcourt les sources d'un slot d'entrée ;
- `readOutputSlots(maxSlots)` : parcourt les cartes de sortie ;
- `readScreens(maxScreens)` : parcourt les écrans ;
- `readReceivingCards(options)` : parcourt les receiving cards après sélection du contexte ;
- `monitor(options)` : orchestre un scan SNMP complet et retourne la structure normalisée.

### `classes/NovaStarApiLib.js`

La classe `NovaStarApiConnector` assure les communications avec l'API HTTP NovaStar.

Fonctions principales :

- `init()` : initialise la connexion et l'authentification ;
- `login()` : demande un token API ;
- `authenticatedPost(path, payload)` : exécute une requête authentifiée et renouvelle la session si nécessaire ;
- `readDetail()` : lit l'inventaire et l'état détaillé du châssis ;
- `readGenLockWorkStatus()` : lit l'état du genlock ;
- `readVideoServerInfo()` : lit les informations du serveur vidéo ;
- `readInitStatus()` : lit l'état d'initialisation, le modèle principal et la version logicielle ;
- `readAll()` : regroupe les lectures API disponibles ;
- `monitor(options)` : normalise les données API pour SNMPViewer.

Fonctions de normalisation importantes :

- `normalizeApiMonitor(...)` : construit le résultat général ;
- `buildController(...)` : construit les champs du contrôleur API ;
- `buildInputSlot(...)` : normalise une carte d'entrée et ses interfaces ;
- `buildOutputSlot(...)` : normalise une carte de sortie ;
- `buildOutputPorts(...)` : transforme les interfaces émettrices en `outputPorts` ;
- `buildMvrCard(...)` : normalise une carte MVR, sa résolution et ses interfaces ;
- `buildMvrInterface(...)` : normalise le type et le signal de chaque interface MVR ;
- `buildMvrVideo(...)` : normalise l'état en ligne et les URL vidéo MVR ;
- `buildUsbPorts(...)` : transforme les statuts USB en éléments individuels ;
- `buildFans(...)` : transforme les statuts ventilateurs en éléments individuels ;
- `buildPowerSupplies(...)` : transforme les signaux d'alimentation en éléments individuels ;
- `buildScreens(...)` : expose la résolution courante sous l'objet de secours `Device`.

### `classes/ModelProfiles.js`

Ce module contient les profils historiques H5/H9 et les limites de parcours associées.

Fonctions principales :

- `normalizeModel(value)` : valide un identifiant de modèle ;
- `getProfile(value)` : retourne les limites associées au modèle.

Le modèle n'est plus saisi dans le formulaire. Le profil H9 sert de limite de sécurité par défaut lorsque le modèle réel n'est pas encore connu.

### `classes/MachineStore.js`

Ce module charge et sauvegarde la liste des équipements.

Fonctions principales :

- `loadMachines()` : lit et normalise le fichier des machines ;
- `saveMachines(machines)` : normalise puis sauvegarde la configuration ;
- `normalizeMachines(value)` : applique les valeurs par défaut et retire les anciens champs obsolètes.

### `classes/Config.js`

Ce module charge `config.json` et expose notamment :

- le port HTTP de l'application ;
- le chemin du fichier des machines ;
- le niveau de journalisation ;
- l'intervalle d'actualisation automatique.

### `classes/Logger.js`

Ce module centralise les journaux `debug`, `info`, `warning` et `error` utilisés pendant les scans et les erreurs de communication.

## Orchestration HTTP

Le fichier `routes/index.js` n'est pas une classe mais constitue le point d'orchestration principal.

Fonctions importantes :

- `handleMonitorRequest(req, res)` : sélectionne le traitement selon le type de machine et le mode d'accès ;
- `collectSnmpData(params, host)` : exécute et normalise le scan SNMP ;
- `collectApiData(params, host)` : exécute et normalise le scan API ;
- `monitorWithHybrid(params, res, host)` : lance les deux sources et assemble le résultat ;
- `buildHybridMonitor(snmpData, apiData)` : applique les priorités par domaine ;
- `preferApiSlotCollection(api, snmp)` : conserve l'inventaire API des slots et utilise SNMP comme complément de champ ;
- `preferSnmpScreens(snmp, api)` : conserve les écrans SNMP et utilise l'API comme secours ou complément ;
- `mergePreferred(primary, fallback)` : fusionne des champs normalisés en conservant la première valeur exploitable.

## Présentation dans l'interface

Le fichier `views/index.ejs` transforme le résultat normalisé en :

- résumé du scan ;
- tableaux détaillés ;
- carte de monitoring globale ;
- pastilles de statut.

Les ports de sortie ont leur propre groupe et leur propre tableau. Les receiving cards restent dans une section séparée. Cette distinction empêche un port API sans lien d'être présenté comme une receiving card défaillante.

Les informations matérielles API disposent également de sections séparées :

- Santé système : température, tension, Ethernet, CPU et mémoire ;
- Cartes MVR : slot, modèle, série, état, résolution et interfaces ;
- Vidéo MVR : présence de la carte, état du flux, URL MVR et URL Echo ;
- USB : état de chaque port ;
- Ventilateurs : état de chaque ventilateur ;
- Alimentations : état de chaque alimentation.

Les codes confirmés par le HAR de l'équipement `192.168.69.94` sont interprétés ainsi : température, tension et ventilateurs à `0` signifient `Normal`; une alimentation avec `iSignal = 1` signifie `Normal`; `mvrCardOnline = 1` et `videoStatus = 1` signifient `Actif`. Un port USB à `0` est affiché `Inactif` et n'est pas considéré comme une panne.
