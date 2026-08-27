# Chantier 2 — Détection des microcoupures

## Situation actuelle

La phase 1 logicielle est implémentée :

- récepteur de traps intégré au backend Node.js avec `net-snmp` ;
- écoute configurable sur UDP `1162` ;
- destination annoncée configurable dans `config.json` ;
- configuration automatique des NovaStar par `SNMP SET` ;
- filtrage des sources NovaStar configurées ;
- conservation des traps bruts et inconnus ;
- décodage extensible des alarmes d’entrée et de sortie ;
- corrélation perte/rétablissement ;
- calcul de la durée des microcoupures ;
- déduplication ;
- journal JSONL avec rotation ;
- diffusion par API et WebSocket ;
- cadre rouge temporaire dans le monitoring et les maps ;
- suppression du cadre au scan périodique suivant ;
- simulateur et tests automatisés.

La suite complète comporte maintenant **68 tests réussis sur 68** pour l'ensemble
du projet, dont les scénarios de traps et de microcoupures simulées.

## Orientation de configuration retenue

Pour une machine NovaStar utilisant API + SNMP, l'interface contient maintenant,
au-dessus de « Paramètres avancés » :

- **Scan SNMP**, fonctionnelle : elle autorise ou interdit les scans SNMP
  périodiques et manuels de la machine ;
- **Trap SNMP**, fonctionnelle : elle contrôle la configuration du NovaStar et
  l'acceptation de ses traps par le récepteur.

L'objectif est de pouvoir désactiver ou fortement espacer les scans SNMP, qui
peuvent prendre plusieurs minutes, tout en conservant les traps SNMP actifs pour
détecter les coupures courtes entre deux scans.

La fréquence des scans SNMP est maintenant indépendante de la fréquence API :
10 minutes par défaut et 4 minutes minimum. Un worker logique par NovaStar permet
le parallélisme entre machines, mais les sélecteurs d'une même machine restent
strictement séquentiels.

## Configuration prévue sur la machine cible

La section suivante doit être présente dans `TAV_Monitoring_Backend/config.json` :

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

`advertised_address` reste configurable et ne doit pas être codée en dur. Le backend vérifie au démarrage que cette adresse appartient bien à la machine locale.

## Phase 1 — Ce qu’il reste à faire avec l’accès réseau

### 0. Séparer l'activation des scans et des traps — terminé

- **Terminé :** ajouter les deux cases fonctionnelles à l'interface.
- **Terminé :** conserver **Scan SNMP** et **Trap SNMP** dans le modèle et dans
  les API de configuration.
- **Terminé :** ne lancer la collecte SNMP périodique ou manuelle que lorsque
  **Scan SNMP** est activé.
- **Terminé :** utiliser une fréquence SNMP distincte de la fréquence API, avec
  10 minutes par défaut et 4 minutes minimum.
- **Terminé :** exécuter un worker logique par NovaStar, sans jamais
  paralléliser les sélecteurs d'une même machine.
- **Terminé :** ne configurer la destination et l'activation des traps sur un
  NovaStar que lorsque sa case **Trap SNMP** est activée.
- **Terminé :** ignorer dans le récepteur les traps d'une machine dont
  **Trap SNMP** est désactivée.

### 1. Corriger les communautés SNMP des NovaStar

Le premier essai de configuration automatique de `192.168.69.86` a retourné :

```text
SNMP SET failed ... error: "NoAccess"
```

Vérifier dans la configuration de chaque NovaStar du monitoring que les valeurs enregistrées sont bien :

- communauté de lecture : `public` ;
- communauté d’écriture : `public`.

Une ancienne valeur explicitement enregistrée, par exemple `private`, est prioritaire sur la valeur par défaut `public`.

### 2. Valider la configuration automatique des traps

Après correction des communautés et redémarrage ou nouveau scan, vérifier pour chaque NovaStar les logs suivants :

```text
SNMP SET completed ... 1.3.6.1.4.1.319.10.200.1
SNMP SET completed ... 1.3.6.1.4.1.319.10.200.3
NovaStar trap destination configured
```

Contrôler séparément au minimum :

- `192.168.69.86` ;
- `192.168.69.85`, si cet équipement doit également envoyer ses traps.

### 3. Relire la configuration lorsque le firmware le permet

Depuis Cygwin :

```sh
snmpget -v2c -c public 192.168.69.86 \
  1.3.6.1.4.1.319.10.200.1 \
  1.3.6.1.4.1.319.10.200.3
```

Résultat attendu :

```text
...200.1 = STRING: "192.168.69.22:1162"
...200.3 = INTEGER: 1
```

Si la relecture est refusée malgré des `SET` réussis, considérer les OID comme potentiellement write-only et poursuivre avec la vérification par réception réelle.

### 4. Vérifier le récepteur du backend

Dans les logs de démarrage :

```text
NovaStar trap receiver started
{"enabled":true,"listening":true,"error":"","listen":"0.0.0.0:1162","advertised":"192.168.69.22:1162"}
```

Dans un navigateur déjà authentifié sur TAV Monitoring :

```text
https://tav-ui.vdoconnect.net/api/novastar-traps/status
```

Pour consulter les événements :

```text
https://tav-ui.vdoconnect.net/api/novastar-traps/events?limit=100
```

Sur la machine backend, l’écoute peut aussi être vérifiée avec :

```powershell
Get-NetUDPEndpoint -LocalPort 1162
```

Il n’y a pas de pare-feu actif sur la machine cible selon les informations disponibles. Vérifier néanmoins qu’aucun autre programme ou `snmptrapd` n’utilise UDP `1162`.

### 5. Capturer et analyser les traps réels accessibles par le réseau

- Laisser le backend fonctionner pendant une période représentative.
- Examiner `TAV_Monitoring_Backend/logs/novastar-traps.jsonl`.
- Identifier les OID, valeurs et formats réellement envoyés par les firmwares.
- Vérifier la présence des identifiants de slot et de port.
- Compléter `NovaStarTrapDecoder.js` uniquement à partir de formats confirmés.
- Conserver les traps non interprétés comme événements inconnus.

La MIB fournit les OID d’alarmes, mais pas le format exact de toutes les chaînes émises par chaque firmware. Il ne faut pas inventer leur signification.

### 6. Valider la chaîne avec le simulateur

Tester au minimum :

- une microcoupure d’entrée ;
- une microcoupure de sortie ;
- une coupure entièrement comprise entre deux scans ;
- des traps dupliqués ;
- une source inconnue ;
- une perte sans rétablissement ;
- plusieurs microcoupures successives.

Vérifier que :

- l’incident est journalisé ;
- le bon élément est encadré en rouge ;
- les maps affichent également le cadre rouge ;
- le cadre disparaît au scan suivant sans nouvel incident ;
- l’événement reste dans le journal.

### 7. Amélioration recommandée du statut

Ajouter ultérieurement un statut détaillé par NovaStar indiquant :

```json
{
  "configured": true,
  "destination": "192.168.69.22:1162",
  "reportingEnabled": true,
  "verifiedAt": "...",
  "lastTrapAt": "..."
}
```

Cela permettrait de distinguer clairement : récepteur actif, `SET` réussi, configuration relue et trap réellement reçu.

## Phase 2 — Ce qu’il restera avec un accès physique

### 1. Préparer les tests contrôlés

- Identifier précisément l’entrée ou la sortie manipulée.
- Noter son état initial et l’heure du test.
- Choisir une coupure plus courte que l’intervalle entre deux scans.
- Vérifier que la manipulation est autorisée et sans risque pour l’exploitation.

### 2. Tester une microcoupure d’entrée

- Débrancher brièvement une entrée identifiée.
- La rebrancher avant le scan suivant.
- Confirmer la réception d’un trap de perte puis d’un trap de rétablissement.
- Vérifier l’identification du bon slot et du bon port.

### 3. Tester une microcoupure de sortie

- Réaliser le même scénario sur une sortie autorisée.
- Confirmer les OID et valeurs reçus.
- Vérifier que la bonne sortie est encadrée en rouge.

### 4. Finaliser le décodeur réel

- Confirmer les valeurs correspondant à la perte et au rétablissement.
- Identifier les variantes selon le modèle et le firmware.
- Détecter les éventuels traps multiples pour un même événement.
- Documenter les traps inconnus ou non exploitables.

### 5. Valider le comportement fonctionnel

- Le scan périodique ne voit pas la coupure courte.
- Le récepteur de traps détecte néanmoins la perte et le retour.
- Le bon élément est encadré en rouge.
- Son état courant reste correctement affiché.
- Le cadre reste visible jusqu’au scan suivant.
- Le cadre disparaît ensuite sans nouvel incident.
- L’historique conserve la microcoupure et sa durée.

### 6. Tester les cas dégradés

- perte sans trap de rétablissement ;
- traps dupliqués ;
- rafale de traps ;
- plusieurs coupures successives ;
- redémarrage du NovaStar ;
- redémarrage du backend ;
- interruption réseau entre le NovaStar et le backend.

### 7. Déployer et observer

- Activer durablement le récepteur Node.
- Surveiller les erreurs, traps inconnus et faux positifs.
- Ajuster la corrélation, la déduplication et la rétention.
- Documenter la configuration finale et la procédure d’exploitation.

## Critères de clôture du chantier 2

Le chantier pourra être considéré comme terminé lorsque :

1. chaque NovaStar attendu est configuré vers `192.168.69.22:1162` ;
2. le backend reçoit effectivement ses traps ;
3. les formats réels perte/rétablissement sont confirmés ;
4. une microcoupure physique entre deux scans est détectée ;
5. le bon élément est encadré temporairement en rouge ;
6. le cadre disparaît au scan suivant sans nouvel incident ;
7. l’incident reste journalisé avec ses heures et sa durée ;
8. les cas dégradés essentiels ne produisent pas de faux positifs majeurs.

L'option **Scan SNMP**, déjà implémentée, devra être validée sur la cible en modes
activé et désactivé, pour les cycles périodiques comme pour les scans manuels.
L'option **Trap SNMP**, maintenant fonctionnelle, devra être validée sur la cible
en modes activé et désactivé, notamment dans le scénario recommandé : scan SNMP
peu fréquent ou désactivé et réception continue des traps.
