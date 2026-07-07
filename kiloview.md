# Kiloview - commandes SNMP a tester

Ce document sert de checklist pour decouvrir ce qu'un equipement Kiloview expose en SNMP avant de l'integrer dans SNMPViewer.

Les commandes ci-dessous utilisent les outils Net-SNMP disponibles via Cygwin, Linux, WSL ou macOS.

## Variables a adapter

```bash
IP_KILOVIEW="192.168.1.50"
READ_COMMUNITY="public"
WRITE_COMMUNITY="private"
OUT_DIR="./snmp-kiloview-$IP_KILOVIEW"
mkdir -p "$OUT_DIR"
```

Si tu ne veux pas utiliser de variables, remplace simplement `$IP_KILOVIEW` par l'adresse IP et `$READ_COMMUNITY` par la community de lecture.

## 1. Verifier que SNMP repond

Ping reseau :

```bash
ping "$IP_KILOVIEW"
```

Test SNMP v2c avec debug court :

```bash
snmpget -d -v2c -c "$READ_COMMUNITY" -On -Le -t 2 -r 1 "$IP_KILOVIEW" .1.3.6.1.2.1.1.1.0
```

Si l'equipement ne repond pas en v2c, tester SNMP v1 :

```bash
snmpget -d -v1 -c "$READ_COMMUNITY" -On -Le -t 2 -r 1 "$IP_KILOVIEW" .1.3.6.1.2.1.1.1.0
```

Resultats attendus :

- `Timeout: No Response` : SNMP desactive, community incorrecte, firewall, VLAN, ou mauvais port.
- `Authentication failure` / erreur d'acces : community ou droits SNMP incorrects.
- Une chaine de description : SNMP fonctionne.

## 2. Lire les informations systeme standard

Ces OID sont standards et ne dependent pas de Kiloview.

```bash
snmpget -v2c -c "$READ_COMMUNITY" -On -Le -t 2 -r 1 "$IP_KILOVIEW" \
  .1.3.6.1.2.1.1.1.0 \
  .1.3.6.1.2.1.1.2.0 \
  .1.3.6.1.2.1.1.3.0 \
  .1.3.6.1.2.1.1.4.0 \
  .1.3.6.1.2.1.1.5.0 \
  .1.3.6.1.2.1.1.6.0
```

Correspondance :

| OID | Nom standard | Utilite |
| --- | --- | --- |
| `.1.3.6.1.2.1.1.1.0` | `sysDescr.0` | Description modele/firmware |
| `.1.3.6.1.2.1.1.2.0` | `sysObjectID.0` | Identifiant constructeur/modele |
| `.1.3.6.1.2.1.1.3.0` | `sysUpTime.0` | Uptime SNMP |
| `.1.3.6.1.2.1.1.4.0` | `sysContact.0` | Contact configure |
| `.1.3.6.1.2.1.1.5.0` | `sysName.0` | Nom de l'equipement |
| `.1.3.6.1.2.1.1.6.0` | `sysLocation.0` | Emplacement configure |

Commande plus lisible si les MIB standards sont installees :

```bash
snmpget -v2c -c "$READ_COMMUNITY" -Le -t 2 -r 1 "$IP_KILOVIEW" \
  SNMPv2-MIB::sysDescr.0 \
  SNMPv2-MIB::sysObjectID.0 \
  SNMPv2-MIB::sysName.0
```

## 3. Recuperer la branche constructeur

Lire le `sysObjectID` :

```bash
snmpget -v2c -c "$READ_COMMUNITY" -On -Oqv -Le -t 2 -r 1 "$IP_KILOVIEW" .1.3.6.1.2.1.1.2.0
```

Si la reponse ressemble a :

```text
.1.3.6.1.4.1.XXXXX....
```

Alors la branche constructeur a tester est probablement :

```text
.1.3.6.1.4.1.XXXXX
```

Important : ne pas supposer l'enterprise ID Kiloview tant qu'il n'a pas ete confirme par `sysObjectID.0` ou par la MIB officielle.

## 4. Walk des branches standards

Systeme :

```bash
snmpwalk -v2c -c "$READ_COMMUNITY" -On -Le -t 2 -r 1 "$IP_KILOVIEW" .1.3.6.1.2.1.1
```

Interfaces reseau :

```bash
snmpwalk -v2c -c "$READ_COMMUNITY" -On -Le -t 2 -r 1 "$IP_KILOVIEW" .1.3.6.1.2.1.2
```

Interfaces et compteurs 64 bits :

```bash
snmpwalk -v2c -c "$READ_COMMUNITY" -On -Le -t 2 -r 1 "$IP_KILOVIEW" .1.3.6.1.2.1.31
```

IP :

```bash
snmpwalk -v2c -c "$READ_COMMUNITY" -On -Le -t 2 -r 1 "$IP_KILOVIEW" .1.3.6.1.2.1.4
```

Host resources, si supporte :

```bash
snmpwalk -v2c -c "$READ_COMMUNITY" -On -Le -t 2 -r 1 "$IP_KILOVIEW" .1.3.6.1.2.1.25
```

## 5. Walk de la branche constructeur

Commencer large pour trouver l'enterprise ID :

```bash
snmpwalk -v2c -c "$READ_COMMUNITY" -On -Le -t 2 -r 1 "$IP_KILOVIEW" .1.3.6.1.4.1
```

Puis refaire un walk cible avec l'enterprise ID obtenu via `sysObjectID.0`.

Exemple avec un ID fictif `XXXXX` :

```bash
snmpwalk -v2c -c "$READ_COMMUNITY" -On -Le -t 2 -r 1 "$IP_KILOVIEW" .1.3.6.1.4.1.XXXXX
```

Pour les equipements qui exposent beaucoup de donnees, tester `snmpbulkwalk` :

```bash
snmpbulkwalk -v2c -c "$READ_COMMUNITY" -On -Le -t 2 -r 1 "$IP_KILOVIEW" .1.3.6.1.4.1.XXXXX
```

## 6. Sauvegarder les sorties de reference

Creer un dossier de capture :

```bash
mkdir -p "$OUT_DIR"
```

Capturer les branches utiles :

```bash
snmpwalk -v2c -c "$READ_COMMUNITY" -On -Le -t 2 -r 1 "$IP_KILOVIEW" .1.3.6.1.2.1.1  > "$OUT_DIR/system.txt"
snmpwalk -v2c -c "$READ_COMMUNITY" -On -Le -t 2 -r 1 "$IP_KILOVIEW" .1.3.6.1.2.1.2  > "$OUT_DIR/interfaces.txt"
snmpwalk -v2c -c "$READ_COMMUNITY" -On -Le -t 2 -r 1 "$IP_KILOVIEW" .1.3.6.1.2.1.31 > "$OUT_DIR/ifx.txt"
snmpwalk -v2c -c "$READ_COMMUNITY" -On -Le -t 2 -r 1 "$IP_KILOVIEW" .1.3.6.1.2.1.25 > "$OUT_DIR/host-resources.txt"
snmpwalk -v2c -c "$READ_COMMUNITY" -On -Le -t 2 -r 1 "$IP_KILOVIEW" .1.3.6.1.4.1   > "$OUT_DIR/private-enterprises.txt"
```

Une fois l'enterprise ID connu :

```bash
ENTERPRISE_OID=".1.3.6.1.4.1.XXXXX"
snmpwalk -v2c -c "$READ_COMMUNITY" -On -Le -t 2 -r 1 "$IP_KILOVIEW" "$ENTERPRISE_OID" > "$OUT_DIR/kiloview-private.txt"
```

## 7. Tester avec SNMP v3 si active

Exemple `authPriv` a adapter :

```bash
SNMP_USER="snmpuser"
SNMP_AUTH_PASS="authPassword"
SNMP_PRIV_PASS="privPassword"

snmpget -v3 -l authPriv -u "$SNMP_USER" \
  -a SHA -A "$SNMP_AUTH_PASS" \
  -x AES -X "$SNMP_PRIV_PASS" \
  -On -Le -t 2 -r 1 "$IP_KILOVIEW" .1.3.6.1.2.1.1.1.0
```

Walk SNMP v3 :

```bash
snmpwalk -v3 -l authPriv -u "$SNMP_USER" \
  -a SHA -A "$SNMP_AUTH_PASS" \
  -x AES -X "$SNMP_PRIV_PASS" \
  -On -Le -t 2 -r 1 "$IP_KILOVIEW" .1.3.6.1.4.1
```

## 8. Charger une MIB Kiloview officielle

Si Kiloview fournit un fichier `.mib`, le placer par exemple dans :

```text
~/.snmp/mibs/
```

Puis tester :

```bash
export MIBS=+ALL
snmptranslate -Tp -IR KILOVIEW-MIB::kiloview
```

Si le nom racine est different, chercher dans le fichier MIB :

```bash
grep -i "OBJECT IDENTIFIER" ~/.snmp/mibs/*.mib
grep -i "kiloview" ~/.snmp/mibs/*.mib
```

Ensuite refaire les commandes sans `-On` pour obtenir les noms lisibles :

```bash
snmpwalk -v2c -c "$READ_COMMUNITY" -Le -t 2 -r 1 "$IP_KILOVIEW" KILOVIEW-MIB::kiloview
```

## 9. Traps SNMP

Si l'equipement sait envoyer des traps, configurer dans son interface web l'IP du PC de supervision et le port `162`.

Ecouter les traps en local :

```bash
snmptrapd -f -Lo -On
```

Avec affichage plus verbeux :

```bash
snmptrapd -f -Lo -On -Ddump
```

Penser a autoriser UDP/162 dans le firewall Windows.

## 10. Points a relever pour l'integration dans SNMPViewer

Pour chaque modele Kiloview, conserver :

| Information | A relever |
| --- | --- |
| Modele exact | Valeur de `sysDescr.0` et/ou page web |
| Firmware | Valeur SNMP et version web UI |
| `sysObjectID.0` | OID constructeur/modele |
| Enterprise OID | Racine `.1.3.6.1.4.1.XXXXX` |
| SNMP version | v1, v2c, v3 |
| Community lecture | Exemple : `public` |
| Community ecriture | Si necessaire |
| Branche privee utile | Walk complet |
| OID statut stream | A identifier |
| OID bitrate / fps | A identifier |
| OID temperature / CPU | A identifier si expose |
| OID alarms | A identifier |
| Traps | Oui/non, OID recus |

## 11. Commande de diagnostic complete

Commande a lancer quand un equipement ne repond pas comme prevu :

```bash
snmpwalk -d -v2c -c "$READ_COMMUNITY" -On -Le -t 2 -r 1 "$IP_KILOVIEW" .1.3.6.1.2.1.1
```

Si la reponse est vide, tester une branche plus large :

```bash
snmpwalk -d -v2c -c "$READ_COMMUNITY" -On -Le -t 2 -r 1 "$IP_KILOVIEW" .1.3.6.1.4.1
```

Si l'equipement repond avec des OID hors de la branche demandee, refaire un walk sur la branche retournee.
