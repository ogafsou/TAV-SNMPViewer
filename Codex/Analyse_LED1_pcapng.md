# Analyse hors ligne de LED1.pcapng

Analyse du 5 novembre 2026. Source : `F:\LED1.pcapng`, 1 044 409 257 octets.

## Résultat

La capture permet de récupérer des températures et tensions **par carte réceptrice** à partir du trafic déjà collecté par NovaLCT. Elle ne démontre pas l'accès aux températures/tensions de chaque module LED raccordé à une carte.

Aucun équipement contacté, aucune commande rejouée, aucun code de production modifié. Les DLL du projet ont servi à lire les métadonnées et le CIL ; leurs constructeurs et méthodes métier n'ont pas été exécutés.

## Capture et trafic

- 506 370 paquets lisibles, sur 196,206 secondes (environ 3 min 16 s).
- La fin du fichier est tronquée au milieu d'un paquet, signalée par capinfos et tshark. Les résultats portent sur la partie lisible.
- Le poste central est `192.168.69.78`. L'attribution de chaque connexion à un processus Windows n'est pas contenue dans la capture.
- Les deux conversations TCP avec `.105:8082` et `.106:8082` représentent environ 1 017 Mo de trafic cumulé, sur 1 027 Mo de données capturées. Des en-têtes `--BoundaryString`, `Nova-type:f0`, `Content-type: image/jpeg` et des signatures JPEG apparaissent : l'essentiel du volume correspond à des images, pas aux mesures de supervision.
- Les commandes binaires sont surtout sur TCP 5200 à 5204. Les noms de services affichés automatiquement par Wireshark sur ces ports ne décrivent pas nécessairement le protocole réel. Le classement automatique iperf3 observé n'est pas une preuve de trafic iperf.
- Aucun échange SNMP reconnu dans la hiérarchie protocolaire de cette capture.

## Protocole binaire exploitable

Les requêtes commencent par `55 AA`, les réponses par `AA 55`. Pour les trames décodées : compteur sur l'octet 3, index de port sur l'octet 7, index de carte sur les octets 8–9, opération sur l'octet 10, adresse sur les octets 12–15, longueur sur les octets 16–17. Les entiers multioctets sont little endian. Les données commencent à l'octet 18. L'opération 0 correspond à une lecture et 1 à une écriture.

Le checksum est la somme des octets depuis l'octet 2 jusqu'à la fin des données, plus `0x5555`, modulo 65536, stockée sur les deux derniers octets en little endian. Cette règle valide les 42 922 trames complètes extraites : 21 486 requêtes de lecture, 118 requêtes d'écriture, 21 300 réponses de lecture et 18 réponses d'écriture.

Ce décompte ne constitue pas un bilan de pertes ni d'acquittements : l'extracteur ne réassemble pas TCP, conserve les retransmissions et ne traite que les trames complètes alignées au début d'un segment, éventuellement concaténées. Les trames fragmentées ou non alignées peuvent être absentes.

## Températures et tensions confirmées

La DLL `NovaLCT/Source/Bin/Nova.Equipment.Protocol.TGProtocol.dll` définit :

- `Scanner_AllMonitorDataAddr = 0x0A000000`, longueur 82.
- Température de carte : octets 0 et 1 du bloc ; validité via le bit `0x80` de l'octet 0, signe via le bit 0, valeur absolue = octet 1 × 0,5 °C.
- Tension de carte : octet 3 ; validité via `0x80`, valeur = `(octet & 0x7F) × 0,1 V`.
- Présence d'une carte de monitoring annexe : octet 32 égal à `0xFF`.

Ces positions et coefficients viennent d'`AddressMapping` et de `TGProtocolParser.ParseMonitorDataByBytes`, `InfoIsValid` et du constructeur statique du parseur, lus hors ligne. Ils correspondent au protocole de la DLL fournie ; la version effectivement installée sur le poste de capture n'a pas été vérifiée.

| Équipement | Réponses de 82 octets | Couples port/carte distincts | Température observée | Tension observée |
|---|---:|---:|---:|---:|
| 192.168.69.81 | 353 | 244 | 39 à 47 °C | 3,9 à 4,6 V |
| 192.168.69.85 | 177 | 177 | 39 à 45 °C | 4,1 à 4,3 V |

Les index de port observés vont de 0 à 15. Leur affichage physique en ports 1 à 16 doit être confirmé avec la configuration. Les couples observés ne sont pas un inventaire garanti exhaustif. Les extrema concernent les réponses extraites, sans diagnostic électrique ni comparaison à des seuils constructeur.

Exemple : réponse du paquet **269849**, équipement `.81`, port index 0, carte index 0, adresse `0x0A000000`, 82 octets, début des données `80 50 00 AA` : température valide **40 °C**, tension valide **4,2 V**. Au paquet **270799**, carte index 1 : `80 52 00 AA`, soit **41 °C**, **4,2 V**.

Les 530 blocs ont l'octet de présence de monitoring annexe à `00`. Ce constat ne suffit pas à conclure que tout monitoring de module est impossible : il concerne ce champ et ces réponses.

Deux autres réponses de 3 octets à la même adresse (`.81` et `.82`) ne doivent pas être interprétées comme des blocs complets de supervision. Une même adresse peut être réutilisée dans différents espaces/appareils ; son nom seul ne suffit pas au décodage.

## Mesures par module : non établies

La DLL contient aussi les adresses `Scanner_AllMonitorModuelDataAddr = 0x0A00000A`, `Scanner_AllMonitorModuelTBS614DataAddr = 0x0A200000` et un espace de monitoring HUB `0x0A100000`. Aucune de ces adresses de départ n'apparaît dans les trames complètes extraites.

Il existe d'autres registres très sollicités, dont `0x1B000005`, `0x020004C2` et `0x020004F5`, dont le sens n'est pas établi ici. Il serait prématuré d'affirmer que la capture ne contient aucune autre donnée de module. Le décodage complet nécessiterait le réassemblage TCP et la correspondance avec la version des bibliothèques du poste.

## Autres informations utiles

- Les annonces UDP de `.101`, `.102`, `.105`, `.106` contiennent du JSON avec `apiPort:8001`, `https:9001`, `authType:0`, `workMode:0` et les adresses MAC. Ces champs décrivent une annonce ; ils ne prouvent pas un contrat HTTP ni un accès sans authentification.
- Des annonces multicast vers `224.0.10.200` donnent `dev:mvr`, des identifiants de slot, versions MCU/FPGA et un champ `port:9851`.
- La découverte UDP 3800 utilise la chaîne `rqProMI:` et reçoit des réponses de plusieurs équipements.
- Il y a aussi des écritures NovaLCT, notamment vers `0x01000000` (100 requêtes), `0x010000A5` (9), `0x02000011` (8) et `0x45000239` (1). Leur rôle n'est pas complètement décodé. Une reproduction globale du trafic ne serait donc pas une simple lecture de mesures.

## Application possible au projet

La piste directement étayée est un **décodage passif** des réponses déjà échangées : équipement, index de port, index de carte, température, tension, validité. Cela peut donner une granularité par carte et aider à établir une correspondance avec la cartographie des cabinets.

Une carte réceptrice peut piloter plusieurs modules : ne pas présenter sa température comme la température de chacun d'eux. Une capture seule ne fournit pas la correspondance complète carte → cabinet → module.

Aucune collecte supplémentaire n'est implémentée. Toute future collecte indépendante ou tout second backend exige de traiter préalablement le verrou partagé par agent NovaStar `host:port`, conformément à AGENTS.md ; les collectes SNMP restent orchestrées par DeviceMonitor et MonitoringService.scanMachine().

## Fichiers de travail

- `tmp/LED1-commandes.tsv` : segments TCP hors port 8082 et paquets UDP, export tshark.
- `tmp/analyse-led1.ps1` : extraction des trames complètes et contrôle de checksum.
- `tmp/LED1-decode.csv` : trames décodées, données brutes et candidats de noms de registres (noms ambigus possibles selon l'espace cible).
- `tmp/LED1-mesures-cartes.csv` : les 530 mesures, index port/carte, validité et données brutes.
- `tmp/LED1-addresses-il.txt`, `tmp/LED1-monitor-framework.txt`, `tmp/LED1-scales.ps1` : preuves de lecture des bibliothèques et coefficients.

Les fichiers temporaires ne sont pas nécessairement suivis par Git.
