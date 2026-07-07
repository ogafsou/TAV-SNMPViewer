# Utilisation de NovaMIB avec Node.js

Guide pratique pour interroger un **NovaStar H9 / H Series** en SNMP depuis Node.js.

> Objectif : comprendre la relation entre `NovaMIB.txt`, les OID NovaStar et l'utilisation du package Node.js `net-snmp`.

---

## 1. Rappel rapide : MIB, OID et valeur

Une **MIB** est un fichier de description. Elle dit :

- quel OID existe ;
- quel nom lisible lui correspond ;
- quel type de donnée est attendu ;
- si l’OID est en lecture seule, écriture seule ou lecture/écriture ;
- ce que signifie la valeur retournée.

Un **OID** est l’adresse numérique d’une information SNMP.

Exemple :

```text
1.3.6.1.4.1.319.10.10.30.2.2
```

Dans NovaMIB, cet OID correspond à une information de firmware de carte de sortie.

La **valeur** est ce que l’équipement renvoie quand on interroge cet OID.

Exemple possible :

```text
"fpgaVersion": "V1.3.4.102", "mcuVersion": "V1.3.4.102", "temp": 47
```

---

## 2. Où se situe NovaStar dans l’arbre SNMP ?

La branche constructeur NovaStar est sous :

```text
1.3.6.1.4.1.319
```

Pour la série H, la branche utile est principalement :

```text
1.3.6.1.4.1.319.10
```

Schéma simplifié :

```text
1.3.6.1.4.1.319.10
├── 10.1    Informations générales du contrôleur
├── 10.20   Cartes d’entrée
├── 10.30   Cartes de sortie
├── 10.40   Écrans configurés
├── 100     Traps / alarmes
└── 200     Configuration des traps
```

---

## 3. Point important : NovaMIB n’est pas toujours une table SNMP classique

Dans beaucoup de MIB SNMP, une table est indexée directement dans l’OID.

Exemple classique fictif :

```text
firmware slot 1 = 1.3.6.1.x.y.z.1
firmware slot 2 = 1.3.6.1.x.y.z.2
firmware slot 3 = 1.3.6.1.x.y.z.3
```

Mais dans la MIB NovaStar H Series que tu consultes, le fonctionnement est différent pour plusieurs blocs.

NovaStar utilise souvent un mécanisme en deux étapes :

```text
1. SET d’un OID de sélection
2. GET d’un OID fixe qui retourne l’information pour l’élément sélectionné
```

Donc pour obtenir le firmware du slot de sortie 1 :

```text
SET slot courant = 1
GET firmware du slot courant
```

Puis pour le slot 2 :

```text
SET slot courant = 2
GET firmware du slot courant
```

---

## 4. Exemple : cartes de sortie

### 4.1 Nombre de slots de sortie

OID :

```text
1.3.6.1.4.1.319.10.10.30.1
```

Rôle :

```text
Number of output card slots
```

Cet OID donne le nombre de slots de sortie disponibles.

---

### 4.2 Sélection du slot de sortie

OID :

```text
1.3.6.1.4.1.319.10.10.30.0
```

Rôle :

```text
Set output card slot ID
```

Type :

```text
Integer / Int
```

Accès :

```text
write-only / set-only
```

Utilisation :

```text
SET 1.3.6.1.4.1.319.10.10.30.0 = 1
```

Cela sélectionne le slot de sortie 1.

---

### 4.3 Lire les informations du slot sélectionné

Une fois le slot sélectionné, ces OID retournent les informations du slot courant :

| Information | OID |
|---|---|
| Statut du slot | `1.3.6.1.4.1.319.10.10.30.2.1` |
| Firmware du slot | `1.3.6.1.4.1.319.10.10.30.2.2` |
| Numéro de série du slot | `1.3.6.1.4.1.319.10.10.30.2.3` |
| Nombre de ports Ethernet du slot | `1.3.6.1.4.1.319.10.10.30.2.4` |
| Résumé JSON/string du slot | `1.3.6.1.4.1.319.10.10.30.3` |

Donc :

```text
Firmware slot 1 :
SET 1.3.6.1.4.1.319.10.10.30.0 = 1
GET 1.3.6.1.4.1.319.10.10.30.2.2

Firmware slot 2 :
SET 1.3.6.1.4.1.319.10.10.30.0 = 2
GET 1.3.6.1.4.1.319.10.10.30.2.2
```

Important : le numéro du slot n’est pas ajouté à la fin de l’OID `...30.2.2`. Il est sélectionné avant via `...30.0`.

---

## 5. Exemple : ports Ethernet et receiving cards

Pour les informations plus fines, NovaStar expose un autre OID de sélection :

```text
1.3.6.1.4.1.319.10.10.30.4
```

Rôle :

```text
Set-SlotId-NetPortId-RecvCardId
```

Type :

```text
OctetString / String
```

Accès :

```text
write-only / set-only
```

Cet OID sert à sélectionner un contexte plus précis :

```text
slot de sortie
port Ethernet
receiving card
```

Exemple de valeur, à adapter selon la syntaxe exacte attendue par ton firmware :

```json
{"outputSlotid":1,"netportId":1,"recvCardId":1}
```

Ensuite, on peut lire des OID fixes comme :

| Information | OID |
|---|---|
| Link status du port Ethernet sélectionné | `1.3.6.1.4.1.319.10.10.30.5.1` |
| Backup port working status | `1.3.6.1.4.1.319.10.10.30.5.3` |
| Backup port link status | `1.3.6.1.4.1.319.10.10.30.5.4` |
| Working status de la receiving card sélectionnée | `1.3.6.1.4.1.319.10.10.30.7.1` |
| Température status receiving card | `1.3.6.1.4.1.319.10.10.30.7.2` |
| Température value receiving card | `1.3.6.1.4.1.319.10.10.30.7.3` |
| Voltage status receiving card | `1.3.6.1.4.1.319.10.10.30.7.4` |
| Voltage value receiving card | `1.3.6.1.4.1.319.10.10.30.7.5` |

---

## 6. Installation Node.js

Créer un projet :

```bash
mkdir novastar-snmp-test
cd novastar-snmp-test
npm init -y
npm install net-snmp
```

Le package `net-snmp` suffit pour faire du SNMP depuis Node.js, y compris sous Windows.

Il ne remplace pas les outils système comme `snmpwalk`, `snmpget` ou `snmptranslate`. Pour ces outils, il faut installer Net-SNMP via Cygwin, WSL, Linux, macOS, etc.

---

## 7. Exemple Node.js : fonctions SNMP de base

Créer un fichier `snmp-client.js` :

```js
const snmp = require("net-snmp");

class SnmpClient {
  constructor({ host, readCommunity = "public", writeCommunity = "private", timeout = 2000, retries = 1 }) {
    this.host = host;
    this.readCommunity = readCommunity;
    this.writeCommunity = writeCommunity;
    this.timeout = timeout;
    this.retries = retries;
  }

  createReadSession() {
    return snmp.createSession(this.host, this.readCommunity, {
      version: snmp.Version2c,
      timeout: this.timeout,
      retries: this.retries,
      port: 161
    });
  }

  createWriteSession() {
    return snmp.createSession(this.host, this.writeCommunity, {
      version: snmp.Version2c,
      timeout: this.timeout,
      retries: this.retries,
      port: 161
    });
  }

  get(oid) {
    return new Promise((resolve, reject) => {
      const session = this.createReadSession();

      session.get([oid], (error, varbinds) => {
        session.close();

        if (error) {
          reject(error);
          return;
        }

        const vb = varbinds[0];

        if (snmp.isVarbindError(vb)) {
          reject(new Error(snmp.varbindError(vb)));
          return;
        }

        resolve(vb.value);
      });
    });
  }

  async getString(oid) {
    const value = await this.get(oid);
    return Buffer.isBuffer(value) ? value.toString("utf8") : String(value);
  }

  async getNumber(oid) {
    const value = await this.get(oid);

    if (typeof value === "number") {
      return value;
    }

    if (Buffer.isBuffer(value)) {
      return Number(value.toString("utf8"));
    }

    return Number(value);
  }

  setInteger(oid, value) {
    return new Promise((resolve, reject) => {
      const session = this.createWriteSession();

      const varbinds = [{
        oid,
        type: snmp.ObjectType.Integer,
        value
      }];

      session.set(varbinds, (error, varbindsResult) => {
        session.close();

        if (error) {
          reject(error);
          return;
        }

        for (const vb of varbindsResult) {
          if (snmp.isVarbindError(vb)) {
            reject(new Error(snmp.varbindError(vb)));
            return;
          }
        }

        resolve(true);
      });
    });
  }

  setString(oid, value) {
    return new Promise((resolve, reject) => {
      const session = this.createWriteSession();

      const varbinds = [{
        oid,
        type: snmp.ObjectType.OctetString,
        value
      }];

      session.set(varbinds, (error, varbindsResult) => {
        session.close();

        if (error) {
          reject(error);
          return;
        }

        for (const vb of varbindsResult) {
          if (snmp.isVarbindError(vb)) {
            reject(new Error(snmp.varbindError(vb)));
            return;
          }
        }

        resolve(true);
      });
    });
  }
}

module.exports = SnmpClient;
```

---

## 8. Exemple Node.js : lire les slots de sortie NovaStar

Créer un fichier `read-output-slots.js` :

```js
const SnmpClient = require("./snmp-client");

const client = new SnmpClient({
  host: "192.168.1.10",
  readCommunity: "public",
  writeCommunity: "private"
});

const OIDS = {
  outputSlotSelector: "1.3.6.1.4.1.319.10.10.30.0",
  outputSlotCount: "1.3.6.1.4.1.319.10.10.30.1",

  outputSlotStatus: "1.3.6.1.4.1.319.10.10.30.2.1",
  outputSlotFirmware: "1.3.6.1.4.1.319.10.10.30.2.2",
  outputSlotSerial: "1.3.6.1.4.1.319.10.10.30.2.3",
  outputSlotNetPortCount: "1.3.6.1.4.1.319.10.10.30.2.4",
  outputSlotSummary: "1.3.6.1.4.1.319.10.10.30.3"
};

async function readOutputSlot(slotId) {
  // Sélectionne le slot courant côté H9
  await client.setInteger(OIDS.outputSlotSelector, slotId);

  // Lit ensuite les infos du slot sélectionné
  const [status, firmware, serial, netPortCount, summary] = await Promise.all([
    client.getString(OIDS.outputSlotStatus),
    client.getString(OIDS.outputSlotFirmware),
    client.getString(OIDS.outputSlotSerial),
    client.getString(OIDS.outputSlotNetPortCount),
    client.getString(OIDS.outputSlotSummary)
  ]);

  return {
    slotId,
    status,
    firmware,
    serial,
    netPortCount,
    summary
  };
}

async function main() {
  const slotCount = await client.getNumber(OIDS.outputSlotCount);

  console.log(`Nombre de slots de sortie : ${slotCount}`);

  for (let slotId = 1; slotId <= slotCount; slotId++) {
    const info = await readOutputSlot(slotId);
    console.log(JSON.stringify(info, null, 2));
  }
}

main().catch((error) => {
  console.error("Erreur SNMP:", error.message);
});
```

Lancer :

```bash
node read-output-slots.js
```

---

## 9. Exemple Node.js : lire un port Ethernet / une receiving card

Créer un fichier `read-receiving-card.js` :

```js
const SnmpClient = require("./snmp-client");

const client = new SnmpClient({
  host: "192.168.1.10",
  readCommunity: "public",
  writeCommunity: "private"
});

const OIDS = {
  selectorSlotPortRecvCard: "1.3.6.1.4.1.319.10.10.30.4",

  ethernetLinkStatus: "1.3.6.1.4.1.319.10.10.30.5.1",
  backupPortWorkingStatus: "1.3.6.1.4.1.319.10.10.30.5.3",
  backupPortLinkStatus: "1.3.6.1.4.1.319.10.10.30.5.4",

  recvCardWorkingStatus: "1.3.6.1.4.1.319.10.10.30.7.1",
  recvCardTemperatureStatus: "1.3.6.1.4.1.319.10.10.30.7.2",
  recvCardTemperatureValue: "1.3.6.1.4.1.319.10.10.30.7.3",
  recvCardVoltageStatus: "1.3.6.1.4.1.319.10.10.30.7.4",
  recvCardVoltageValue: "1.3.6.1.4.1.319.10.10.30.7.5"
};

function buildSelectorValue({ outputSlotId, netPortId, recvCardId = 0 }) {
  // Selon les versions de firmware, le format attendu peut être sensible.
  // Le plus sûr est de tester d'abord la valeur exacte dans un MIB Browser.
  return JSON.stringify({
    outputSlotid: outputSlotId,
    netportId: netPortId,
    recvCardId
  });
}

async function selectReceivingCard({ outputSlotId, netPortId, recvCardId }) {
  const value = buildSelectorValue({ outputSlotId, netPortId, recvCardId });
  await client.setString(OIDS.selectorSlotPortRecvCard, value);
}

async function readReceivingCard({ outputSlotId, netPortId, recvCardId }) {
  await selectReceivingCard({ outputSlotId, netPortId, recvCardId });

  const [
    ethernetLinkStatus,
    backupPortWorkingStatus,
    backupPortLinkStatus,
    recvCardWorkingStatus,
    recvCardTemperatureStatus,
    recvCardTemperatureValue,
    recvCardVoltageStatus,
    recvCardVoltageValue
  ] = await Promise.all([
    client.getString(OIDS.ethernetLinkStatus),
    client.getString(OIDS.backupPortWorkingStatus),
    client.getString(OIDS.backupPortLinkStatus),
    client.getString(OIDS.recvCardWorkingStatus),
    client.getString(OIDS.recvCardTemperatureStatus),
    client.getString(OIDS.recvCardTemperatureValue),
    client.getString(OIDS.recvCardVoltageStatus),
    client.getString(OIDS.recvCardVoltageValue)
  ]);

  return {
    outputSlotId,
    netPortId,
    recvCardId,
    ethernetLinkStatus,
    backupPortWorkingStatus,
    backupPortLinkStatus,
    recvCardWorkingStatus,
    recvCardTemperatureStatus,
    recvCardTemperatureValue,
    recvCardVoltageStatus,
    recvCardVoltageValue
  };
}

async function main() {
  const info = await readReceivingCard({
    outputSlotId: 1,
    netPortId: 1,
    recvCardId: 1
  });

  console.log(JSON.stringify(info, null, 2));
}

main().catch((error) => {
  console.error("Erreur SNMP:", error.message);
});
```

---

## 10. Attention à la concurrence

Comme NovaStar utilise des OID de sélection, il faut éviter de faire ceci :

```text
Thread A : SET slot = 1
Thread B : SET slot = 2
Thread A : GET firmware
```

Dans cet exemple, le Thread A risque de lire le firmware du slot 2, pas du slot 1.

Il faut donc séquentialiser les opérations :

```text
SET slot = 1
GET infos slot 1

SET slot = 2
GET infos slot 2

SET slot = 3
GET infos slot 3
```

Dans un serveur Node.js, évite de lancer plusieurs lectures NovaStar en parallèle sur le même équipement quand elles utilisent des OID de sélection.

Approche recommandée :

```text
1 file d’attente par équipement
1 seul cycle de polling NovaStar actif par équipement
```

---

## 11. Conseils d’architecture pour un serveur de monitoring

Pour un serveur de monitoring simple :

```text
Node.js poller
  ├── lit les équipements SNMP
  ├── normalise les valeurs
  ├── écrit dans une base time-series
  └── expose une API ou envoie vers Prometheus/InfluxDB
```

Exemple de modèle interne :

```js
{
  deviceId: "novastar-h9-prod-01",
  timestamp: "2026-06-04T10:15:00.000Z",
  metrics: {
    "output.slot.1.status": 1,
    "output.slot.1.firmware": "V1.3.4.102",
    "output.slot.1.netPortCount": 16,
    "output.slot.2.status": 1
  }
}
```

Pour Prometheus, transforme plutôt en métriques numériques :

```text
novastar_output_slot_status{device="h9-01",slot="1"} 1
novastar_output_slot_netport_count{device="h9-01",slot="1"} 16
novastar_recvcard_temperature{device="h9-01",slot="1",port="1",card="1"} 47
```

Pour les chaînes de caractères comme firmware/SN, tu peux les stocker dans PostgreSQL ou les exposer sous forme d’info metric :

```text
novastar_output_slot_info{device="h9-01",slot="1",firmware="V1.3.4.102",serial="..."} 1
```

---

## 12. Community SNMP et droits

En SNMPv2c, on utilise souvent :

```text
public  = lecture seule
private = lecture/écriture
```

Mais ce n’est qu’une convention.

Pour NovaStar, certains OID nécessaires à la lecture détaillée sont en `set-only` ou `write-only`, car ils servent à sélectionner un contexte. Même si tu ne changes pas réellement la configuration métier de l’équipement, ton client doit pouvoir faire un `SET`.

Donc ton serveur Node.js aura probablement besoin :

```text
- d’une community en lecture pour les GET
- d’une community en écriture pour les SET de sélection
```

À vérifier dans la configuration SNMP de ton H9.

---

## 13. Checklist de test

### 13.1 Vérifier que SNMP répond

```bash
snmpget -v2c -c public 192.168.1.10 1.3.6.1.2.1.1.1.0
```

### 13.2 Lire le nombre de slots de sortie

```bash
snmpget -v2c -c public 192.168.1.10 1.3.6.1.4.1.319.10.10.30.1
```

### 13.3 Sélectionner le slot 1

```bash
snmpset -v2c -c private 192.168.1.10 1.3.6.1.4.1.319.10.10.30.0 i 1
```

### 13.4 Lire le firmware du slot sélectionné

```bash
snmpget -v2c -c public 192.168.1.10 1.3.6.1.4.1.319.10.10.30.2.2
```

### 13.5 Faire la même chose en Node.js

```bash
node read-output-slots.js
```

---

## 14. Pièges courants

### Piège 1 : ajouter le numéro du slot à la fin du mauvais OID

Ne pas faire :

```text
1.3.6.1.4.1.319.10.10.30.2.2.1
```

sauf si ta version de MIB/documentation indique explicitement un index `N` dans l’OID.

Dans la version avec sélecteur, il faut faire :

```text
SET .30.0 = 1
GET .30.2.2
```

---

### Piège 2 : lancer trop de GET en parallèle

À cause du mécanisme de sélection, il faut éviter les requêtes concurrentes sur le même équipement pour les blocs qui utilisent des sélecteurs.

---

### Piège 3 : oublier que certains `SET` sont des sélecteurs

Tous les `SET` ne changent pas forcément un paramètre opérationnel visible. Certains servent seulement à choisir le contexte de lecture.

Mais ils nécessitent quand même une community SNMP avec droit d’écriture.

---

### Piège 4 : supposer que toutes les versions NovaStar utilisent exactement les mêmes OID

NovaStar peut faire évoluer ses OID selon :

```text
- gamme H / COEX / autre contrôleur
- version firmware
- version de NovaMIB.txt
- version du document SNMP Protocol Instructions
```

Il faut toujours vérifier :

```text
1. la version firmware du H9
2. la version de NovaMIB.txt
3. les exemples donnés dans le document SNMP de la même version
```

---

## 15. Sources à conserver dans le projet

- `NovaMIB.txt` : fichier MIB NovaStar à télécharger depuis la documentation NovaStar.
- `H Series SNMP Protocol Instructions` : document d’explication des OID et des exemples Get/Set.
- Documentation npm du package Node.js `net-snmp`.

---

## 16. Résumé opérationnel

Pour lire le firmware du slot de sortie 1 :

```text
1. SET 1.3.6.1.4.1.319.10.10.30.0 = 1
2. GET 1.3.6.1.4.1.319.10.10.30.2.2
```

Pour lire le firmware du slot de sortie 2 :

```text
1. SET 1.3.6.1.4.1.319.10.10.30.0 = 2
2. GET 1.3.6.1.4.1.319.10.10.30.2.2
```

En Node.js :

```text
npm install net-snmp
```

Puis :

```js
await client.setInteger("1.3.6.1.4.1.319.10.10.30.0", 1);
const firmware = await client.getString("1.3.6.1.4.1.319.10.10.30.2.2");
```

C’est le cœur du fonctionnement NovaMIB pour ces blocs : **sélectionner, puis lire**.
