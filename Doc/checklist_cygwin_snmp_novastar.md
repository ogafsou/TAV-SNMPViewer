# Checklist Cygwin pour tester SNMP sur NovaStar H9

Ce mémo donne les commandes de base à taper dans **Cygwin** pour vérifier une connexion SNMP, tester un équipement NovaStar H9 / H Series, puis commencer quelques lectures utiles.

Remplace les valeurs suivantes par celles de ton environnement :

```bash
IP_H9="192.168.1.10"
READ_COMMUNITY="public"
WRITE_COMMUNITY="private"
```

---

## 1. Vérifier que les outils SNMP sont installés

Dans le terminal **Cygwin64 Terminal** :

```bash
snmpget -V
snmpwalk -V
snmptranslate -V
snmpset -V
```

Si les commandes ne sont pas reconnues, il faut installer le paquet Cygwin :

```text
net-snmp-utils
```

---

## 2. Définir des variables pratiques

Ces variables évitent de retaper l’adresse IP et les communities à chaque commande.

```bash
IP_H9="192.168.1.10"
READ_COMMUNITY="public"
WRITE_COMMUNITY="private"
```

Adapter :

```text
192.168.1.10 → adresse IP réelle du H9
public       → community SNMP en lecture
private      → community SNMP en écriture
```

---

## 3. Tester la connexion SNMP standard

### Lire la description système

```bash
snmpget -v2c -c "$READ_COMMUNITY" "$IP_H9" 1.3.6.1.2.1.1.1.0
```

Cet OID correspond à :

```text
sysDescr.0
```

Il retourne généralement une description de l’équipement.

### Lire l’identifiant constructeur / modèle

```bash
snmpget -v2c -c "$READ_COMMUNITY" "$IP_H9" 1.3.6.1.2.1.1.2.0
```

Cet OID correspond à :

```text
sysObjectID.0
```

Il permet souvent d’identifier le constructeur ou la famille d’équipement.

### Lire le nom système

```bash
snmpget -v2c -c "$READ_COMMUNITY" "$IP_H9" 1.3.6.1.2.1.1.5.0
```

Cet OID correspond à :

```text
sysName.0
```

---

## 4. Faire un premier snmpwalk standard

```bash
snmpwalk -v2c -c "$READ_COMMUNITY" "$IP_H9" 1.3.6.1.2.1.1
```

Cette commande explore la branche standard :

```text
system
```

Tu devrais voir des informations comme :

```text
sysDescr.0
sysObjectID.0
sysUpTime.0
sysContact.0
sysName.0
sysLocation.0
```

Si cette commande répond, la connexion SNMP de base est correcte.

---

## 5. Tester la branche NovaStar

La branche constructeur NovaStar est :

```text
1.3.6.1.4.1.319
```

Pour la série H, la branche utile est généralement :

```text
1.3.6.1.4.1.319.10
```

Tester toute la branche NovaStar H Series :

```bash
snmpwalk -v2c -c "$READ_COMMUNITY" "$IP_H9" 1.3.6.1.4.1.319.10
```

Tester seulement les informations contrôleur :

```bash
snmpwalk -v2c -c "$READ_COMMUNITY" "$IP_H9" 1.3.6.1.4.1.319.10.10.1
```

Tester seulement les cartes de sortie :

```bash
snmpwalk -v2c -c "$READ_COMMUNITY" "$IP_H9" 1.3.6.1.4.1.319.10.10.30
```

---

## 6. Lire le nombre de slots de sortie

```bash
snmpget -v2c -c "$READ_COMMUNITY" "$IP_H9" 1.3.6.1.4.1.319.10.10.30.1
```

Cet OID correspond au nombre de slots de sortie.

Exemple logique :

```text
1.3.6.1.4.1.319.10.10.30.1 = 4
```

Cela indiquerait que l’équipement expose 4 slots de sortie.

---

## 7. Sélectionner le slot de sortie 1

Dans NovaMIB, certaines informations ne sont pas indexées directement à la fin de l’OID.

Il faut d’abord sélectionner le slot courant avec un `SET`, puis lire les OID fixes.

Sélectionner le slot 1 :

```bash
snmpset -v2c -c "$WRITE_COMMUNITY" "$IP_H9" 1.3.6.1.4.1.319.10.10.30.0 i 1
```

Détail :

```text
1.3.6.1.4.1.319.10.10.30.0 = sélecteur du slot de sortie
i 1                                  = valeur entière 1
```

---

## 8. Lire les informations du slot sélectionné

Après avoir sélectionné un slot, lire ses informations :

```bash
snmpget -v2c -c "$READ_COMMUNITY" "$IP_H9" 1.3.6.1.4.1.319.10.10.30.2.1
snmpget -v2c -c "$READ_COMMUNITY" "$IP_H9" 1.3.6.1.4.1.319.10.10.30.2.2
snmpget -v2c -c "$READ_COMMUNITY" "$IP_H9" 1.3.6.1.4.1.319.10.10.30.2.3
snmpget -v2c -c "$READ_COMMUNITY" "$IP_H9" 1.3.6.1.4.1.319.10.10.30.2.4
```

Correspondance :

```text
1.3.6.1.4.1.319.10.10.30.2.1 = statut du slot sélectionné
1.3.6.1.4.1.319.10.10.30.2.2 = firmware du slot sélectionné
1.3.6.1.4.1.319.10.10.30.2.3 = numéro de série du slot sélectionné
1.3.6.1.4.1.319.10.10.30.2.4 = nombre de ports réseau du slot sélectionné
```

---

## 9. Tester le slot 2

Sélectionner le slot 2 :

```bash
snmpset -v2c -c "$WRITE_COMMUNITY" "$IP_H9" 1.3.6.1.4.1.319.10.10.30.0 i 2
```

Lire son firmware :

```bash
snmpget -v2c -c "$READ_COMMUNITY" "$IP_H9" 1.3.6.1.4.1.319.10.10.30.2.2
```

Important :

```text
Le numéro du slot n’est pas ajouté à la fin de l’OID firmware.
On sélectionne le slot avec .30.0, puis on lit .30.2.2.
```

---

## 10. Charger NovaMIB.txt avec Net-SNMP

Si le fichier `NovaMIB.txt` est dans :

```text
~/mibs/NovaMIB.txt
```

Tester la traduction d’un OID :

```bash
snmptranslate -M +~/mibs -m +ALL 1.3.6.1.4.1.319.10.10.30.2.2
```

Faire un walk en chargeant les MIB :

```bash
snmpwalk -M +~/mibs -m +ALL -v2c -c "$READ_COMMUNITY" "$IP_H9" 1.3.6.1.4.1.319.10.10.30
```

Si la MIB est bien chargée, certains OID numériques peuvent apparaître avec des noms plus lisibles.

---

## 11. Tester avec timeout et retry limités

Si l’équipement ne répond pas ou si les commandes semblent bloquées :

```bash
snmpget -v2c -c "$READ_COMMUNITY" -t 2 -r 1 "$IP_H9" 1.3.6.1.2.1.1.1.0
```

Paramètres :

```text
-t 2 = timeout de 2 secondes
-r 1 = 1 retry
```

---

## 12. Séquence minimale recommandée

À copier-coller pour un premier diagnostic :

```bash
IP_H9="192.168.1.10"
READ_COMMUNITY="public"
WRITE_COMMUNITY="private"

snmpget -v2c -c "$READ_COMMUNITY" "$IP_H9" 1.3.6.1.2.1.1.1.0

snmpwalk -v2c -c "$READ_COMMUNITY" "$IP_H9" 1.3.6.1.4.1.319.10.10.30

snmpget -v2c -c "$READ_COMMUNITY" "$IP_H9" 1.3.6.1.4.1.319.10.10.30.1

snmpset -v2c -c "$WRITE_COMMUNITY" "$IP_H9" 1.3.6.1.4.1.319.10.10.30.0 i 1

snmpget -v2c -c "$READ_COMMUNITY" "$IP_H9" 1.3.6.1.4.1.319.10.10.30.2.2
```

---

## 13. Interpréter les problèmes courants

### Aucun retour / timeout

Causes possibles :

```text
- mauvaise adresse IP
- équipement non joignable
- SNMP désactivé sur le H9
- firewall bloquant UDP 161
- mauvaise community SNMP
- mauvaise version SNMP
```

Tester la connectivité réseau :

```bash
ping "$IP_H9"
```

Attention : le ping peut répondre même si SNMP est bloqué.

### Erreur d’authentification ou pas de réponse

Vérifier :

```text
- community de lecture
- community d’écriture
- droits SNMP configurés sur le H9
```

### Le GET fonctionne mais le SET échoue

Probable cause :

```text
La community d’écriture n’est pas correcte ou les SET SNMP sont désactivés.
```

Pour NovaMIB, certains `SET` sont nécessaires pour sélectionner un slot ou un contexte de lecture.

### Les OID restent numériques même avec NovaMIB

Vérifier :

```text
- le fichier NovaMIB.txt est bien dans ~/mibs
- l’option -M +~/mibs est bien utilisée
- l’option -m +ALL est bien utilisée
- les dépendances MIB éventuelles sont disponibles
```

---

## 14. Rappel sur le fonctionnement NovaStar

Pour lire le firmware du slot 1 :

```text
SET 1.3.6.1.4.1.319.10.10.30.0 = 1
GET 1.3.6.1.4.1.319.10.10.30.2.2
```

Pour lire le firmware du slot 2 :

```text
SET 1.3.6.1.4.1.319.10.10.30.0 = 2
GET 1.3.6.1.4.1.319.10.10.30.2.2
```

Le slot est donc sélectionné avant la lecture. Il n’est pas ajouté à la fin de l’OID firmware.

---

## 15. Notes de sécurité

SNMPv2c utilise des communities en clair.

Recommandations :

```text
- utiliser un réseau de supervision séparé
- éviter la community "public" en production
- limiter les IP autorisées à interroger l’équipement
- utiliser SNMPv3 si disponible et correctement supporté
- éviter les droits d’écriture SNMP trop larges
```

---

## 16. Commandes utiles à garder

```bash
# Version des outils
snmpget -V
snmpwalk -V
snmptranslate -V
snmpset -V

# Test standard
snmpget -v2c -c "$READ_COMMUNITY" "$IP_H9" 1.3.6.1.2.1.1.1.0

# Walk système
snmpwalk -v2c -c "$READ_COMMUNITY" "$IP_H9" 1.3.6.1.2.1.1

# Walk NovaStar
snmpwalk -v2c -c "$READ_COMMUNITY" "$IP_H9" 1.3.6.1.4.1.319.10

# Nombre de slots de sortie
snmpget -v2c -c "$READ_COMMUNITY" "$IP_H9" 1.3.6.1.4.1.319.10.10.30.1

# Sélection slot 1
snmpset -v2c -c "$WRITE_COMMUNITY" "$IP_H9" 1.3.6.1.4.1.319.10.10.30.0 i 1

# Firmware slot sélectionné
snmpget -v2c -c "$READ_COMMUNITY" "$IP_H9" 1.3.6.1.4.1.319.10.10.30.2.2

# Avec NovaMIB
snmpwalk -M +~/mibs -m +ALL -v2c -c "$READ_COMMUNITY" "$IP_H9" 1.3.6.1.4.1.319.10.10.30
```
