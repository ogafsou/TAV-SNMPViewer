# NovaStar Nova MIB - Description humaine

Ce document resume le fichier `Codex/NovaMIB.txt` dans un format plus simple a lire.

La MIB expose des informations SNMP pour des equipements NovaStar, notamment le controleur, les slots d'entree, les slots de sortie, les cartes de reception, les ecrans et les traps.

## Informations generales

| Element | Valeur |
| --- | --- |
| Constructeur | Xi'an NovaStar Tech Co., Ltd. |
| Version MIB | V1.0.0 |
| Entreprise SNMP | `1.3.6.1.4.1.319` |
| Racine Nova | `1.3.6.1.4.1.319.10` |

## Types et acces

| Terme | Signification |
| --- | --- |
| `OctetString` / `String` | Texte ou donnees encodees sous forme de chaine |
| `Integer` | Valeur numerique entiere |
| `read-only` | Lecture uniquement |
| `write-only` | Ecriture uniquement, souvent pour selectionner un slot, un ecran ou une carte avant lecture |
| `read-write` / `read and write` | Lecture et ecriture |

## OID version

| OID | Nom | Type | Acces | Description |
| --- | --- | --- | --- | --- |
| `1.3.6.1.4.1.319.10.1` | `OID-Version` | `OctetString` | `read-only` | Version courante des OID |

## Controleur

Ces OID decrivent l'etat general du controleur NovaStar.

| OID | Nom | Type | Acces | Description |
| --- | --- | --- | --- | --- |
| `1.3.6.1.4.1.319.10.10.1.0` | `Controller-Info-Summary` | `OctetString` | `read-only` | Resume des informations controleur |
| `1.3.6.1.4.1.319.10.10.1.1` | `Controller-Time` | `OctetString` | `read-only` | Temps de fonctionnement du controleur |
| `1.3.6.1.4.1.319.10.10.1.2` | `Controller-Model` | `OctetString` | `read-only` | Modele du controleur |
| `1.3.6.1.4.1.319.10.10.1.3` | `Firmware-Version` | `OctetString` | `read-only` | Version firmware |
| `1.3.6.1.4.1.319.10.10.1.4` | `Controller-SerialNumber` | `OctetString` | `read-only` | Numero de serie |
| `1.3.6.1.4.1.319.10.10.1.5` | `Controller-MACAddress` | `OctetString` | `read-only` | Adresse MAC |
| `1.3.6.1.4.1.319.10.10.1.6` | `Wired-IPAddress` | `OctetString` | `read-only` | Adresse IP filaire |
| `1.3.6.1.4.1.319.10.10.1.7` | `ARM-Version` | `OctetString` | `read-only` | Version ARM |
| `1.3.6.1.4.1.319.10.10.1.8` | `Controller-Temperature-Status` | `OctetString` | `read-only` | Etat de temperature du controleur |
| `1.3.6.1.4.1.319.10.10.1.9` | `Controller-Fan-Count` | `OctetString` | `read-only` | Nombre de ventilateurs |
| `1.3.6.1.4.1.319.10.10.1.10` | `Controller-Power-Count` | `OctetString` | `read-only` | Nombre d'alimentations |
| `1.3.6.1.4.1.319.10.10.1.11` | `Controller-GenlockLinkStatus` | `OctetString` | `read-only` | Etat du lien genlock |
| `1.3.6.1.4.1.319.10.10.1.12` | `Controller-Genlock-Frame` | `OctetString` | `read-only` | Frame genlock |
| `1.3.6.1.4.1.319.10.10.1.14` | `Controller-WorkingStatus` | `OctetString` | `read-only` | Etat de fonctionnement du controleur |
| `1.3.6.1.4.1.319.10.10.1.14` | `Controller-CPU-Status` | `OctetString` | `read-only` | Etat CPU |
| `1.3.6.1.4.1.319.10.10.1.15` | `Controller-Memory-Status` | `OctetString` | `read-only` | Etat memoire |
| `1.3.6.1.4.1.319.10.10.1.16` | `Controller-Fans-Status` | `OctetString` | `read-only` | Etat des ventilateurs |
| `1.3.6.1.4.1.319.10.10.1.17` | `Controller-Power-Status` | `OctetString` | `read-only` | Etat des alimentations |

Note : la MIB source contient deux entrees avec l'OID `1.3.6.1.4.1.319.10.10.1.14` : `Controller-WorkingStatus` et `Controller-CPU-Status`.

## Slots d'entree

Les slots d'entree utilisent d'abord des OID de selection, puis des OID de lecture pour le slot ou la source selectionnee.

| OID | Nom | Type | Acces | Description |
| --- | --- | --- | --- | --- |
| `1.3.6.1.4.1.319.10.10.20.0` | `Set-InputSlot-ID` | `Integer` | `write-only` | Selectionne le slot d'entree |
| `1.3.6.1.4.1.319.10.10.20.1` | `InputSlot-Count` | `Integer` | `read-only` | Nombre de slots d'entree |
| `1.3.6.1.4.1.319.10.10.20.22.1` | `InputSlot-Status` | `OctetString` | `read-only` | Etat du slot d'entree selectionne |
| `1.3.6.1.4.1.319.10.10.20.22.2` | `InputSlot-FirmwareVersion` | `OctetString` | `read-only` | Firmware du slot d'entree selectionne |
| `1.3.6.1.4.1.319.10.10.20.22.2` | `InputSlot-SerialNumber` | `OctetString` | `read-only` | Numero de serie du slot d'entree selectionne |
| `1.3.6.1.4.1.319.10.10.20.22.4` | `InputSlot-InputSourcesNumber` | `OctetString` | `read-only` | Nombre de sources du slot d'entree selectionne |
| `1.3.6.1.4.1.319.10.10.20.3` | `InputSlot-Summary` | `OctetString` | `read-only` | Resume du slot d'entree |
| `1.3.6.1.4.1.319.10.10.20.4` | `Set-InputSlotId-SourceId` | `OctetString` | `write-only` | Selectionne un couple slot/source |
| `1.3.6.1.4.1.319.10.10.20.5.1` | `Input-Source-Status` | `Integer` | `read-only` | Etat de la source d'entree |
| `1.3.6.1.4.1.319.10.10.20.5.2` | `Input-Source-Width` | `Integer` | `read-only` | Largeur de la source |
| `1.3.6.1.4.1.319.10.10.20.5.3` | `Input-Source-Height` | `Integer` | `read-only` | Hauteur de la source |
| `1.3.6.1.4.1.319.10.10.20.5.4` | `Input-Sources-FrameRate` | `OctetString` | `read-only` | Frequence d'image de la source |
| `1.3.6.1.4.1.319.10.10.20.5.5` | `Input-Source-Type` | `Integer` | `read-only` | Type de source |

Note : la MIB source contient deux entrees avec l'OID `1.3.6.1.4.1.319.10.10.20.22.2` : firmware et numero de serie.

## Slots de sortie

Les slots de sortie utilisent un OID de selection, puis des OID de lecture pour le slot selectionne.

| OID | Nom | Type | Acces | Description |
| --- | --- | --- | --- | --- |
| `1.3.6.1.4.1.319.10.10.30.0` | `Set-Output-ID` | `Integer` | `write-only` | Selectionne le slot de sortie |
| `1.3.6.1.4.1.319.10.10.30.1` | `OutputSlot-Count` | `Integer` | `read-only` | Nombre de slots de sortie |
| `1.3.6.1.4.1.319.10.10.30.2.1` | `Slot-Status` | `OctetString` | `read-only` | Etat du slot de sortie |
| `1.3.6.1.4.1.319.10.10.30.2.2` | `FirmwareVersion` | `OctetString` | `read-only` | Firmware du slot de sortie |
| `1.3.6.1.4.1.319.10.10.30.2.3` | `SerialNumber` | `OctetString` | `read-only` | Numero de serie du slot de sortie |
| `1.3.6.1.4.1.319.10.10.30.2.4` | `NetPort-Number` | `OctetString` | `read-only` | Nombre de ports reseau du slot |
| `1.3.6.1.4.1.319.10.10.30.3` | `OutputSlot-Info-Summary` | `OctetString` | `read-only` | Resume du slot de sortie |
| `1.3.6.1.4.1.319.10.10.30.4` | `Set-SlotId-NetPortId-RecvCardId` | `OctetString` | `write-only` | Selectionne slot, port reseau et carte de reception |

## Ports reseau

Ces OID concernent le port reseau associe a un slot de sortie.

| OID | Nom | Type | Acces | Description |
| --- | --- | --- | --- | --- |
| `1.3.6.1.4.1.319.10.10.30.5.1` | `NetPortLinkStatus` | `Integer` | `read-only` | Etat du lien du port reseau |
| `1.3.6.1.4.1.319.10.10.30.5.3` | `NetPortBackupStatus` | `Integer` | `read-only` | Etat du port de secours |
| `1.3.6.1.4.1.319.10.10.30.5.4` | `BackupNetPortLinkStatus` | `Integer` | `read-only` | Etat du lien du port de secours |
| `1.3.6.1.4.1.319.10.10.30.5.5` | `FiberLinkStatus` | `OctetString` | `read-only` | Etat du lien fibre |

## Cartes de reception

Les cartes de reception sont lues apres selection via `Set-SlotId-NetPortId-RecvCardId`.

| OID | Nom | Type | Acces | Description |
| --- | --- | --- | --- | --- |
| `1.3.6.1.4.1.319.10.10.30.7.1` | `RecvCardInfoSummary` | `OctetString` | `read-only` | Resume de la carte de reception |
| `1.3.6.1.4.1.319.10.10.30.7.1` | `WorkingStatus` | `Integer` | `read-only` | Etat de fonctionnement de la carte de reception |
| `1.3.6.1.4.1.319.10.10.30.7.2` | `TemperatureStatus` | `Integer` | `read-only` | Etat de temperature de la carte de reception |
| `1.3.6.1.4.1.319.10.10.30.7.3` | `TemperatureValue` | `Integer` | `read-only` | Valeur de temperature |
| `1.3.6.1.4.1.319.10.10.30.7.4` | `VoltageStatus` | `Integer` | `read-only` | Etat de tension |
| `1.3.6.1.4.1.319.10.10.30.7.5` | `VoltageValue` | `Integer` | `read-only` | Valeur de tension |
| `1.3.6.1.4.1.319.10.10.30.7.6` | `FPGAVersion` | `OctetString` | `read-only` | Version FPGA |
| `1.3.6.1.4.1.319.10.10.30.7.7` | `MCUVersion` | `OctetString` | `read-only` | Version MCU |
| `1.3.6.1.4.1.319.10.10.30.7.8` | `MaxTemperature` | `Integer` | `read-only` | Temperature maximale |

Note : la MIB source contient deux entrees avec l'OID `1.3.6.1.4.1.319.10.10.30.7.1` : resume et etat de fonctionnement.

## Ecrans

Les OID d'ecran utilisent un OID de selection, puis des OID de lecture ou d'ecriture pour l'ecran selectionne.

| OID | Nom | Type | Acces | Description |
| --- | --- | --- | --- | --- |
| `1.3.6.1.4.1.319.10.10.40.0` | `Set-Screen-Id` | `Integer` | `write-only` | Selectionne l'ecran |
| `1.3.6.1.4.1.319.10.10.40.1` | `ScreenNum` | `Integer` | `read-only` | Nombre d'ecrans |
| `1.3.6.1.4.1.319.10.10.40.3` | `Screen-Summary` | `String` | `read-only` | Resume de l'ecran |
| `1.3.6.1.4.1.319.10.10.40.2.1` | `ScreenName` | `OctetString` | `read-only` | Nom de l'ecran |
| `1.3.6.1.4.1.319.10.10.40.2.2` | `ScreenWidth` | `Integer` | `read-only` | Largeur de l'ecran |
| `1.3.6.1.4.1.319.10.10.40.2.3` | `ScreenHeight` | `Integer` | `read-only` | Hauteur de l'ecran |
| `1.3.6.1.4.1.319.10.10.40.2.4` | `FrameRate` | `Integer` | `read-only` | Frequence d'image |
| `1.3.6.1.4.1.319.10.10.40.2.5` | `Screen-Brightness` | `OctetString` | `read and write` | Luminosite de l'ecran |
| `1.3.6.1.4.1.319.10.10.40.2.6` | `Screen-SyncType` | `OctetString` | `read-only` | Type de synchronisation |
| `1.3.6.1.4.1.319.10.10.40.2.7` | `Screen-SyncFrame` | `OctetString` | `read-only` | Frame de synchronisation |
| `1.3.6.1.4.1.319.10.10.40.2.8` | `ScreenDisplayMode` | `Integer` | `read and write` | Mode d'affichage |

## Configuration des traps

Ces OID configurent la destination et l'activation des rapports de trap.

| OID | Nom | Type | Acces | Description |
| --- | --- | --- | --- | --- |
| `1.3.6.1.4.1.319.10.200.1` | `Controller-IPPort` | `OctetString` | `read-write` | Adresse du service trap, IP et port |
| `1.3.6.1.4.1.319.10.200.3` | `Controller-ReportEnable` | `Integer` | `read-write` | Active ou desactive l'envoi de rapports trap |

## Traps envoyes

Ces OID representent les messages ou categories de traps emis par l'equipement.

| OID | Nom | Type | Acces | Description |
| --- | --- | --- | --- | --- |
| `1.3.6.1.4.1.319.10.100.1` | `deviceAlarm` | `OctetString` | `read-write` | Alarme equipement |
| `1.3.6.1.4.1.319.10.100.2` | `inputCardSourceCount` | `OctetString` | `read-write` | Nombre de sources de carte d'entree |
| `1.3.6.1.4.1.319.10.100.3` | `outputCardSourceCount` | `OctetString` | `read-write` | Nombre de sources de carte de sortie |
| `1.3.6.1.4.1.319.10.100.4` | `genlock` | `OctetString` | `read-write` | Trap genlock |
| `1.3.6.1.4.1.319.10.100.5` | `snmpStartTime` | `OctetString` | `read-write` | Heure de demarrage SNMP |
| `1.3.6.1.4.1.319.10.100.6` | `InputSlotAlarm` | `OctetString` | `read-write` | Alarme slot d'entree |
| `1.3.6.1.4.1.319.10.100.7` | `OutputSlotAlarm` | `OctetString` | `read-write` | Alarme slot de sortie |

## Points d'attention

- Plusieurs OID sont utilises comme selecteurs en ecriture avant de lire une zone detaillee : slot d'entree, source d'entree, slot de sortie, carte de reception ou ecran.
- Certains OID semblent dupliques dans la MIB source. Ils sont conserves tels quels dans ce document pour faciliter la comparaison avec `NovaMIB.txt`.
- Les champs `Integer` peuvent representer des codes d'etat. La MIB ne fournit pas toujours la correspondance entre code numerique et libelle humain.

## Exemples de commandes Cygwin / SNMP tools

Les exemples ci-dessous utilisent les outils Net-SNMP disponibles sous Cygwin : `snmpget`, `snmpset` et `snmpwalk`.

Remplacez :

- `192.168.1.10` par l'adresse IP du controleur NovaStar.
- `public` par la communaute SNMP de lecture.
- `private` par la communaute SNMP d'ecriture.

### Tester la communication SNMP

Lire la version des OID NovaStar :

```sh
snmpget -v2c -c public 192.168.1.10 1.3.6.1.4.1.319.10.1
```

Lire le modele du controleur :

```sh
snmpget -v2c -c public 192.168.1.10 1.3.6.1.4.1.319.10.10.1.2
```

Lire le firmware du controleur :

```sh
snmpget -v2c -c public 192.168.1.10 1.3.6.1.4.1.319.10.10.1.3
```

### Lire les informations principales du controleur

```sh
snmpget -v2c -c public 192.168.1.10 \
  1.3.6.1.4.1.319.10.10.1.0 \
  1.3.6.1.4.1.319.10.10.1.2 \
  1.3.6.1.4.1.319.10.10.1.3 \
  1.3.6.1.4.1.319.10.10.1.4 \
  1.3.6.1.4.1.319.10.10.1.5 \
  1.3.6.1.4.1.319.10.10.1.6
```

### Parcourir une branche de la MIB

Parcourir les informations controleur :

```sh
snmpwalk -v2c -c public 192.168.1.10 1.3.6.1.4.1.319.10.10.1
```

Parcourir les informations des slots de sortie :

```sh
snmpwalk -v2c -c public 192.168.1.10 1.3.6.1.4.1.319.10.10.30
```

Parcourir les informations des ecrans :

```sh
snmpwalk -v2c -c public 192.168.1.10 1.3.6.1.4.1.319.10.10.40
```

### Lire les slots de sortie

Lire le nombre de slots de sortie :

```sh
snmpget -v2c -c public 192.168.1.10 1.3.6.1.4.1.319.10.10.30.1
```

Selectionner le slot de sortie numero `1` :

```sh
snmpset -v2c -c private 192.168.1.10 1.3.6.1.4.1.319.10.10.30.0 i 1
```

Lire les informations du slot de sortie selectionne :

```sh
snmpget -v2c -c public 192.168.1.10 \
  1.3.6.1.4.1.319.10.10.30.2.1 \
  1.3.6.1.4.1.319.10.10.30.2.2 \
  1.3.6.1.4.1.319.10.10.30.2.3 \
  1.3.6.1.4.1.319.10.10.30.2.4 \
  1.3.6.1.4.1.319.10.10.30.3
```

### Lire une carte de reception

Selectionner la carte de reception `1`, sur le port reseau `1`, du slot de sortie `1`.

La valeur envoyee est une chaine JSON :

```sh
snmpset -v2c -c private 192.168.1.10 \
  1.3.6.1.4.1.319.10.10.30.4 \
  s '{"outputSlotid":1,"netportId":1,"recvCardId":1}'
```

Lire l'etat de cette carte de reception :

```sh
snmpget -v2c -c public 192.168.1.10 \
  1.3.6.1.4.1.319.10.10.30.5.1 \
  1.3.6.1.4.1.319.10.10.30.5.3 \
  1.3.6.1.4.1.319.10.10.30.5.4 \
  1.3.6.1.4.1.319.10.10.30.5.5 \
  1.3.6.1.4.1.319.10.10.30.7.1 \
  1.3.6.1.4.1.319.10.10.30.7.2 \
  1.3.6.1.4.1.319.10.10.30.7.3 \
  1.3.6.1.4.1.319.10.10.30.7.4 \
  1.3.6.1.4.1.319.10.10.30.7.5 \
  1.3.6.1.4.1.319.10.10.30.7.6 \
  1.3.6.1.4.1.319.10.10.30.7.7 \
  1.3.6.1.4.1.319.10.10.30.7.8
```

### Lire les ecrans

Lire le nombre d'ecrans :

```sh
snmpget -v2c -c public 192.168.1.10 1.3.6.1.4.1.319.10.10.40.1
```

Selectionner l'ecran numero `1` :

```sh
snmpset -v2c -c private 192.168.1.10 1.3.6.1.4.1.319.10.10.40.0 i 1
```

Lire les informations de l'ecran selectionne :

```sh
snmpget -v2c -c public 192.168.1.10 \
  1.3.6.1.4.1.319.10.10.40.2.1 \
  1.3.6.1.4.1.319.10.10.40.2.2 \
  1.3.6.1.4.1.319.10.10.40.2.3 \
  1.3.6.1.4.1.319.10.10.40.2.4 \
  1.3.6.1.4.1.319.10.10.40.2.5 \
  1.3.6.1.4.1.319.10.10.40.2.6 \
  1.3.6.1.4.1.319.10.10.40.2.7 \
  1.3.6.1.4.1.319.10.10.40.2.8 \
  1.3.6.1.4.1.319.10.10.40.3
```

### Modifier la luminosite d'un ecran

Selectionner d'abord l'ecran :

```sh
snmpset -v2c -c private 192.168.1.10 1.3.6.1.4.1.319.10.10.40.0 i 1
```

Modifier la luminosite. Exemple avec la valeur texte `50` :

```sh
snmpset -v2c -c private 192.168.1.10 1.3.6.1.4.1.319.10.10.40.2.5 s 50
```

### Configurer les traps

Lire l'adresse de destination des traps :

```sh
snmpget -v2c -c public 192.168.1.10 1.3.6.1.4.1.319.10.200.1
```

Definir une destination de trap. Exemple : `192.168.1.50:162` :

```sh
snmpset -v2c -c private 192.168.1.10 1.3.6.1.4.1.319.10.200.1 s 192.168.1.50:162
```

Activer le rapport de traps :

```sh
snmpset -v2c -c private 192.168.1.10 1.3.6.1.4.1.319.10.200.3 i 1
```

Desactiver le rapport de traps :

```sh
snmpset -v2c -c private 192.168.1.10 1.3.6.1.4.1.319.10.200.3 i 0
```

### Astuces de diagnostic

Afficher les reponses sans traduction de MIB, utile quand les MIB locales ne sont pas installees :

```sh
snmpget -On -v2c -c public 192.168.1.10 1.3.6.1.4.1.319.10.10.1.2
```

Ajouter un timeout et un nombre de tentatives :

```sh
snmpget -v2c -c public -t 2 -r 1 192.168.1.10 1.3.6.1.4.1.319.10.10.1.2
```

Afficher plus de details pour diagnostiquer une requete :

```sh
snmpget -d -v2c -c public 192.168.1.10 1.3.6.1.4.1.319.10.10.1.2
```
