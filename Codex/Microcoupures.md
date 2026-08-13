# Détection des microcoupures NovaStar H

## Objectif

Les scans SNMP périodiques donnent principalement l'état courant des entrées
et des sorties. Une coupure très brève peut donc commencer et se terminer entre
deux scans sans être détectée.

La piste étudiée consiste à recevoir les traps SNMP envoyés par le NovaStar H.
Un trap reçu au moment de la perte ou du rétablissement du signal permettrait
de conserver la trace d'une microcoupure survenue entre deux scans.

## Tests disponibles

Deux tests Node.js sont disponibles dans le projet. Ils ne nécessitent pas
l'installation de `snmptrapd`.

### 1. Auto-test local du récepteur

Ce test démarre un récepteur local, lui envoie un trap NovaStar simulé, puis
vérifie que le trap est reçu et décodé :

```bat
cd /d D:\Projets\FFT\RG2026\TAV\SNMPViewer
npm run test:trap
```

Le résultat attendu se termine par :

```text
Récepteur de traps NovaStar : OK
```

Cet auto-test valide le programme de réception local. Il ne prouve pas que le
NovaStar H est configuré pour envoyer ses traps.

### 2. Écoute des traps du NovaStar H

Ce test écoute les traps provenant du NovaStar `192.168.69.86` sur le port UDP
`1162` :

```bat
cd /d D:\Projets\FFT\RG2026\TAV\SNMPViewer
set NOVASTAR_IP=192.168.69.86
set TRAP_PORT=1162
npm run listen:novastar-traps
```

La fenêtre doit rester ouverte pendant les essais de coupure. Le port UDP
entrant `1162` doit également être autorisé dans le pare-feu Windows.

## Configuration prévue sur le NovaStar H

Le PC de réception utilisé dans cet exemple a l'adresse `192.168.69.50`. Les
commandes prévues pour configurer le NovaStar sont :

```sh
snmpset -v2c -c private 192.168.69.86 1.3.6.1.4.1.319.10.200.1 s "192.168.69.50:1162"
snmpset -v2c -c private 192.168.69.86 1.3.6.1.4.1.319.10.200.3 i 1
```

- `1.3.6.1.4.1.319.10.200.1` définit l'adresse IP et le port du récepteur ;
- `1.3.6.1.4.1.319.10.200.3` active l'envoi des rapports de traps.

## Blocage constaté le 24 juillet 2026

À ce jour, les deux commandes de configuration ne passent pas. Le NovaStar
répond :

```text
conta@TAV-HIGOLE-01 ~
$ snmpset -v2c -c private 192.168.69.86 1.3.6.1.4.1.319.10.200.1 s "192.168.69.50:1162"
snmpset -v2c -c private 192.168.69.86 1.3.6.1.4.1.319.10.200.3 i 1
Error in packet.
Reason: noAccess
Error in packet.
Reason: noAccess
```

La réponse `noAccess` indique que le NovaStar reçoit et comprend les requêtes,
mais refuse l'écriture sur ces OID dans le contexte SNMP utilisé. Le problème
n'est donc pas l'absence de communication avec `192.168.69.86`.

Les causes possibles à vérifier sont notamment :

- la communauté d'écriture n'est peut-être pas `private` ;
- les écritures SNMP peuvent être désactivées dans la configuration du H ;
- la communauté utilisée peut être limitée à la lecture ;
- le firmware ou le modèle concerné peut interdire la modification de ces OID ;
- la configuration des traps doit peut-être être effectuée depuis l'interface
  Web ou le logiciel NovaStar plutôt que par `snmpset`.

Tant que ce refus `noAccess` n'est pas levé, l'auto-test local reste utilisable,
mais le test réel ne peut pas confirmer si le NovaStar émet une alarme lors
d'une microcoupure.
