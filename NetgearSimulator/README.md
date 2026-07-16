# NETGEAR M4300 Simulator

Simulateur SNMP v2c autonome pour tester le type `NETGEAR M4300` de TAV Monitoring sans switch physique.

## Installation et démarrage

```powershell
Set-Location NetgearSimulator
npm install
npm start
```

Interface : `http://127.0.0.1:8091`

SNMP : `127.0.0.1:1161`, communauté `public`.

Dans TAV Monitoring :

- Type : `NETGEAR M4300`
- Adresse IP : `127.0.0.1`
- Lecture : `public`
- Port SNMP : `1161`
- PoE : optionnel

Le simulateur publie `SNMPv2-MIB`, `IF-MIB`, `ifXTable` et `POWER-ETHERNET-MIB` pour les champs utilisés par le connecteur.
