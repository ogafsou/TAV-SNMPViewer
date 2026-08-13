# Point de reprise après vacances

Dernière mise à jour : **28 juillet 2026**  
Retour prévu : vers le **11 août 2026**

## Résumé rapide

Le diagnostic principal sur les lectures SNMP NovaStar est établi :

- le NovaStar `192.168.69.86` accepte les `SNMP SET` ;
- il faut utiliser la communauté d’écriture **`public`**, et non `private` ;
- SNMP v1 et SNMP v2c fonctionnent, mais l’application reste en **SNMP v2c** ;
- `Set-Screen-Id` fonctionne avec un `INTEGER` ;
- les modifications permettant d’utiliser `public/public` par défaut sont faites
  localement ;
- une correction locale supplémentaire balaye maintenant les vrais IDs physiques
  des slots au lieu de supposer que les cartes occupent les IDs `1..count` ;
- **ces dernières corrections locales ne sont pas encore déployées sur le
  backend de production**.

La priorité au retour est donc :

1. relire et valider les changements locaux ;
2. déployer/redémarrer le backend ;
3. relancer un scan de `H2-Main` ;
4. vérifier les entrées `I-1`, `I-3` et les sorties situées vers `O-11`,
   `O-12` ;
5. terminer la configuration et la validation des traps de microcoupures.

## Environnement accessible

- Interface : <https://tav-ui.vdoconnect.net>
- Backend : <https://tav-rg-lt16.vdoconnect.net>
- Santé du backend :
  <https://tav-rg-lt16.vdoconnect.net/api/health>
- Le 28 juillet 2026, `/api/health` répondait :

```json
{"ok":true,"service":"TAV_Monitoring_Backend"}
```

- Les endpoints de supervision protégés, par exemple `/api/monitoring`,
  répondent `401 Authentication required` sans session valide.

## Diagnostic SNMP confirmé

### Commande de référence fonctionnelle

```sh
snmpset -v2c -c public 192.168.69.86 \
  1.3.6.1.4.1.319.10.10.40.0 i 1
```

Résultat obtenu :

```text
SNMPv2-SMI::enterprises.319.10.10.40.0 = INTEGER: 1
```

La même commande fonctionne également en SNMP v1.

### Cause du `noAccess`

Les essais avec `-c private` retournaient :

```text
Error in packet.
Reason: noAccess
```

Le type ASN.1 et la version SNMP n’étaient pas la cause. La communauté
d’écriture attendue par ce NovaStar est `public`.

### Paramètres NovaStar à utiliser

```json
{
  "accessMethod": "snmp",
  "readCommunity": "public",
  "writeCommunity": "public",
  "snmpPort": "161"
}
```

Pour une machine déjà enregistrée, saisir explicitement `public` dans le champ
**Écriture**. Laisser ce champ vide pendant une modification conserve l’ancienne
valeur enregistrée.

## Modifications locales effectuées

### Valeurs par défaut

Les nouveaux NovaStar utilisent maintenant :

- lecture : `public` ;
- écriture : `public`.

Les valeurs ont été changées dans le frontend, le service de monitoring et le
connecteur SNMP.

### Parcours des écrans et des slots

Le connecteur applique la séquence suivante :

1. lecture du compteur ;
2. `SET` du sélecteur ;
3. attente de la réponse au `SET` ;
4. `GET` des champs associés ;
5. passage à l’élément suivant.

Cette séquence couvre :

- les slots d’entrée ;
- les sources de chaque slot d’entrée ;
- les slots de sortie ;
- les ports réseau/receiving cards ;
- les écrans.

### Correction des slots non consécutifs

Le compteur SNMP indique le **nombre de cartes présentes**, pas nécessairement
les IDs physiques à interroger.

Exemple constaté sur l’interface :

- deux entrées peuvent être installées en `I-1` et `I-3` ;
- deux sorties peuvent être installées en `O-11` et `O-12`.

L’ancien code lisait seulement les IDs `1` et `2`. Le code local balaye
désormais les IDs physiques, ignore les emplacements qui retournent
`ERROR: BizIdError`, puis s’arrête quand il a trouvé le nombre de cartes annoncé.

Les états des ports lus via les receiving cards sont aussi rattachés aux slots
de sortie pour alimenter le tableau `Outputs`.

### Validation locale

Commande exécutée :

```powershell
node tests\run.js
```

Résultat au 28 juillet 2026 :

```text
43 tests, 43 réussis, 0 échec
```

Un test vérifie spécifiquement un inventaire non contigu :

- entrées physiques `1` et `3` ;
- sorties physiques `11` et `12` ;
- chaque lecture respecte l’ordre `SET` puis `GET`.

## Ce qui reste à faire sur les entrées et sorties

- [ ] Examiner le diff avant déploiement.
- [ ] Vérifier que la machine de production utilise bien
  `writeCommunity = public`.
- [ ] Déployer la version locale du backend.
- [ ] Redémarrer le service backend.
- [ ] Relancer le scan de `H2-Main`.
- [ ] Vérifier que les lignes correspondent aux vrais IDs physiques.
- [ ] Vérifier que tous les ports de chaque carte de sortie apparaissent.
- [ ] Contrôler les journaux :
  `SNMP input slots read started`,
  `SNMP output slots read started`,
  `SNMP SET completed`.
- [ ] Vérifier le temps total du scan : le balayage physique réalise davantage
  de requêtes SNMP.
- [ ] Créer une nouvelle référence de monitoring seulement après validation du
  nouvel inventaire.

## État Git à ne pas oublier

Le répertoire de travail contient de nombreuses modifications et plusieurs
fichiers non suivis, dont des travaux antérieurs sans rapport direct avec la
correction SNMP.

À faire avant tout commit :

```powershell
git status --short
git diff --check
git diff -- TAV_Monitoring_Backend/classes/SnmpLib.js
git diff -- TAV_Monitoring_Backend/services/DeviceMonitor.js
git diff -- TAV_Monitoring_UI/public/javascripts/application.js
git diff -- TAV_Monitoring_UI/public/javascripts/configuration.js
git diff -- TAV_Monitoring_UI/views/partials/configuration/creation-edition-dialog.ejs
git diff -- tests/backend-monitoring.test.js
```

Ne pas committer aveuglément tout le worktree. Isoler les fichiers concernés
et vérifier les autres modifications avec leur propriétaire.

## Microcoupures : objectif

Les scans périodiques ne voient que l’état au moment du scan. Une perte de
signal très courte peut commencer et finir entre deux scans.

L’objectif est donc de recevoir les traps NovaStar en temps réel, de les
horodater et de conserver les événements de perte et de rétablissement.

Les scripts actuels sont des outils de validation. Le récepteur de traps n’est
pas encore intégré comme service permanent dans le backend.

## Microcoupures : fichiers déjà présents

- `tests/novastar-trap-test.js` : écouteur Node.js sur UDP 1162 ;
- `tests/novastar-trap-receiver.test.js` : auto-test local avec trap simulé ;
- `Codex/Microcoupures.md` : notes précédentes ;
- `Codex/Mail_Novastar.txt` : brouillon de demande au support NovaStar.

Attention : les anciennes notes utilisent encore `private`. Il faut désormais
utiliser **`public`** dans les commandes envoyées à `192.168.69.86`.

## Microcoupures : procédure recommandée au retour

### 1. Identifier l’adresse du récepteur

Sur la machine qui exécutera le récepteur :

```powershell
ipconfig
```

Vérifier l’adresse réellement joignable depuis le réseau `192.168.69.0/24`.
Les notes utilisent `192.168.69.50`, mais cette adresse doit être confirmée.

Dans les exemples suivants :

```text
RECEIVER_IP=192.168.69.50
RECEIVER_PORT=1162
NOVASTAR_IP=192.168.69.86
```

### 2. Valider le récepteur Node local

Depuis la racine :

```powershell
npm run test:trap
```

Résultat attendu :

```text
Récepteur de traps NovaStar : OK
```

### 3. Autoriser UDP 1162 dans le pare-feu Windows

Créer une règle entrante limitée au profil/réseau utile. Exemple à exécuter
dans une console administrateur après validation du nom et du périmètre :

```powershell
New-NetFirewallRule `
  -DisplayName "TAV NovaStar SNMP traps UDP 1162" `
  -Direction Inbound `
  -Protocol UDP `
  -LocalPort 1162 `
  -Action Allow
```

À faire :

- [ ] limiter si possible la règle au sous-réseau ou aux IP NovaStar ;
- [ ] vérifier qu’aucun autre programme n’utilise UDP 1162 ;
- [ ] documenter la règle dans la procédure d’exploitation.

### 4. Démarrer l’écoute avant de configurer le NovaStar

PowerShell :

```powershell
$env:NOVASTAR_IP="192.168.69.86"
$env:TRAP_PORT="1162"
npm run listen:novastar-traps
```

Cygwin :

```sh
NOVASTAR_IP=192.168.69.86 TRAP_PORT=1162 npm run listen:novastar-traps
```

Laisser la fenêtre ouverte pendant toute la validation.

### 5. Abonner/configurer le NovaStar vers le récepteur

Configurer la destination :

```sh
snmpset -v2c -c public 192.168.69.86 \
  1.3.6.1.4.1.319.10.200.1 s "192.168.69.50:1162"
```

Activer l’envoi des traps :

```sh
snmpset -v2c -c public 192.168.69.86 \
  1.3.6.1.4.1.319.10.200.3 i 1
```

Ces commandes n’ont pas encore été revalidées avec `public`. L’ancien test
avec `private` échouait en `noAccess`, mais le diagnostic récent montre que
`public` est la communauté d’écriture correcte pour les sélecteurs.

Résultats à noter :

- réponse exacte de chaque `snmpset` ;
- valeur relue si l’OID autorise un `GET` ;
- heure de configuration ;
- IP/port réellement enregistrés.

### 6. Provoquer une microcoupure contrôlée

- [ ] noter l’heure précise ;
- [ ] couper brièvement une entrée identifiée ;
- [ ] rétablir l’entrée ;
- [ ] répéter sur une sortie si cela est autorisé ;
- [ ] conserver tous les traps reçus, y compris leurs OID et varbinds ;
- [ ] comparer avec les changements visibles par le scan périodique.

Il faut confirmer si le NovaStar émet :

- un trap à la perte de signal ;
- un trap au rétablissement ;
- un trap différent selon entrée/sortie ;
- l’identifiant du slot et du port ;
- un timestamp exploitable ;
- plusieurs traps pour un même événement.

### 7. Option `snmptrapd`

Le projet fonctionne actuellement avec un récepteur Node.js et ne dépend pas
de `snmptrapd`. Si `snmptrapd` est retenu pour l’exploitation :

1. installer les outils Net-SNMP contenant `snmptrapd` ;
2. créer une configuration autorisant la communauté reçue ;
3. écouter sur UDP 1162 ;
4. journaliser en OID numériques pour éviter les ambiguïtés de MIB.

Exemple minimal de `snmptrapd.conf` à adapter :

```text
authCommunity log public
```

Exemple d’écoute :

```sh
snmptrapd -f -Lo -On -c /chemin/snmptrapd.conf udp:1162
```

À valider selon la version Net-SNMP installée. Ne pas lancer simultanément
`snmptrapd` et le récepteur Node sur le même port.

### 8. Intégration permanente à réaliser

- [ ] choisir entre un récepteur Node intégré et `snmptrapd` ;
- [ ] démarrer automatiquement le récepteur avec le backend ;
- [ ] ne pas bloquer le démarrage si le port est déjà occupé ;
- [ ] filtrer les traps par IP NovaStar autorisée ;
- [ ] décoder et nommer les OID NovaStar ;
- [ ] conserver chaque événement avec timestamp, source, OID et valeur ;
- [ ] corréler perte/rétablissement pour calculer la durée ;
- [ ] éviter les doublons et tempêtes de traps ;
- [ ] exposer les microcoupures dans l’API et l’interface ;
- [ ] envoyer éventuellement une notification `ntfy` ;
- [ ] définir une rétention et une rotation des journaux ;
- [ ] ajouter des tests d’intégration ;
- [ ] documenter la désactivation des traps :

```sh
snmpset -v2c -c public 192.168.69.86 \
  1.3.6.1.4.1.319.10.200.3 i 0
```

## Ordre conseillé pour la première journée de reprise

1. Lire ce fichier et lancer `git status --short`.
2. Lancer `node tests\run.js`.
3. Vérifier/configurer `public/public` sur H2-Main.
4. Déployer le backend corrigé.
5. Relancer le scan et contrôler les vrais slots/ports.
6. Ne recréer la référence qu’après validation.
7. Lancer l’auto-test des traps.
8. Ouvrir UDP 1162 de manière contrôlée.
9. Configurer les OID `.200.1` et `.200.3` avec la communauté `public`.
10. Faire une microcoupure contrôlée et archiver les traps observés.

## Critères de réussite

La reprise sera considérée comme validée lorsque :

- toutes les cartes d’entrée et de sortie présentes sont affichées avec leur
  vrai ID physique ;
- tous les ports attendus sont visibles ;
- les scans répétés donnent un inventaire stable ;
- le NovaStar envoie des traps vers le récepteur ;
- une microcoupure contrôlée est enregistrée avec perte et rétablissement ;
- le récepteur fonctionne automatiquement et les événements sont visibles
  dans l’outil de monitoring.
