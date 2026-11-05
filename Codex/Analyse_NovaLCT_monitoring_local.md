# Analyse hors ligne du monitoring NovaLCT

Date : 22 octobre 2026.

## Conclusion

Les fichiers fournis contiennent un moteur de monitoring, un bus local WCF et un composant XCenter local. Une passerelle utilisant les donnees deja collectees par NovaLCT est une piste concrete. L'acces externe aux temperatures et tensions de chaque module LED n'est cependant pas encore valide.

La piste la mieux comprise apres cette analyse est le bus WCF pour recevoir les evenements existants. Le flux destine a l'interface NovaLCT est une synthese de supervision : il ne faut pas le confondre avec toutes les mesures brutes des modules.

Aucun programme NovaStar n'a ete lance, aucune DLL NovaStar n'a ete chargee pour execution, aucun equipement ni service local n'a ete contacte. Les DLL ont ete lues comme fichiers PE/metadonnees/CIL. Aucun code de production de SNMPViewer n'a ete modifie.

## 1. XCenter : service local confirme, API de mesures non etablie

Fichiers :

- `NovaLCT/Source/Bin/MonitorManager/xcenter/config/runtime_info.env`
- `NovaLCT/Source/Bin/MonitorManager/xcenter/config/server/runtime.toml`
- `NovaLCT/Source/Bin/XcenterBusiness.dll`

Constats :

- Le fichier runtime_info.env est un instantane genere le 20 octobre 2026 a 18:34:11. Il ne prouve pas qu'un processus tourne actuellement.
- Ports HTTP et WebSocket indiques : 19180. Le port est local au PC NovaLCT, pas une nouvelle adresse de service sur le H9.
- Le constructeur `XcenterAccessInterface` initialise `localhost`, le port `19180` et `isHttps = true`.
- `GetUrl` choisit entre HTTPS et HTTP. Des certificats locaux sont references. Il serait donc incorrect de supposer automatiquement HTTP en clair.
- Les chemins retrouves dans le client incluent `api/v1/xcenter/screen`, `api/v1/xcenter/device/isFindEnd`, mais aussi des operations de configuration, verrouillage et rafraichissement.
- `RefreshRvCard` utilise `api/v1/xcenter/notify/refresh/rvCard` : ce chemin ne doit pas etre traite comme une simple consultation du cache.
- Aucun contrat HTTP/WebSocket complet de lecture passive de toutes les mesures par module n'a ete reconstitue.

Attention : les chaines de l'executable Go LCT_XCenter comprennent des noms de packages/types et des routes concatenees sans separateur. Une chaine contenant `/api/` ne constitue pas a elle seule un endpoint valide.

Preuves CIL : `tmp/novalct-xcenter-il.txt`.

## 2. Bus local WCF : mecanisme d'abonnement identifie

Assemblies : `Nova.Monitoring.Common.dll` et `Nova.Monitoring.Engine.dll` dans `NovaLCT/Source/Bin/MonitorManager/`.

- Contrat serveur : `IDataService` (Login, Register, Logout, Hello, SendCommand, ExecuteCommand).
- Contrat de rappel : `IDataClient` (ReceiveDataNew, ReceiveCommandNew).
- Transport : `NetNamedPipeBinding`, donc integration Windows/.NET plutot qu'un appel HTTP Node.js direct.
- `MonitorGlobalConfig.PipeAddress` contient `localhost/novadata`.
- La fabrique utilise le schema net.pipe et le chemin `/IDataService`. L'URI finale doit encore etre verifiee ; ne pas construire une adresse par simple concatenation de ces chaines.
- `DataService.Login` memorise le nom puis ajoute le client a la collection du moteur.
- `DataService.Register` memorise les cles d'abonnement (ou `*`). Dans ce corps de methode, aucun appel de lecture materielle n'apparait.
- Les corps examines de Login/AddService gerent les clients. Cela ne constitue pas une garantie generale sur tous les effets d'une session WCF en fonctionnement.

Le flux `M3_MonitoringData` est special : le moteur conserve l'objet `AllMonitorData` dans `GlobleMonitorData`, puis le rappel WCF transmet un marqueur portant le nom du flux. Ce rappel ne transmet donc pas automatiquement l'objet complet des mesures. Charger Engine.dll dans un helper distinct ne donnerait pas acces a la memoire du processus NovaLCT.

Preuves CIL : `tmp/novalct-common-il.txt`, `tmp/novalct-common-statics-il.txt`, `tmp/novalct-engine-il.txt`, `tmp/novalct-callbacks-il.txt`.

## 3. Donnees par module et synthese d'alarmes : deux niveaux distincts

Les bibliotheques contiennent les references `ModuleMonitorInfoCollection`, `OneModuleInfo`, `TemperatureTBS`, `VoltageTBS`, `ModuleState` et les traitements `GetModuleErrData`.

`GetModuleErrData` parcourt les informations de modules et utilise notamment `get_Temperature` et `get_Voltage`. Il existe donc du traitement de mesures individuelles dans les fichiers fournis.

`SendMonitorDataToLCT` serialise un objet et l'envoie dans un message interne de code 20, cible 2. Le client NovaLCT reconnait ce code comme `MonitorDataToLCT` et transmet le contenu a `GetErrorMonitorDataEvent`.

Le modele `LCTMainMonitorData` expose FaultMonitorInfos, AlarmMonitorInfos, RefreshTypeInfo, ValidInfo et RedundantStateInfoDic. Ce flux est prometteur pour des etats/alertes, mais sa couverture des mesures de chaque module normal n'est pas demontree.

Attention au nom `GetModuleData` : le corps examine construit aussi des informations d'ecran et des correspondances de cartes. Son nom seul ne prouve pas l'existence d'une API de temperatures par module.

Preuves CIL : `tmp/novalct-modules-il.txt`, `tmp/novalct-dataflow-il.txt`, `tmp/novalct-client-command-il.txt`, `tmp/novalct-lct-model-il.txt`.

## 4. Stockage local

`NovaLCT/NovaLCT 2012/Config/Monitoring/MonitorDb.db` a ete ouverte en mode SQLite lecture seule. Pas de table evidente de mesures brutes par module ; predominance de configurations et journaux d'operations.

`DataAcquisition_MonitorData.json` est vide dans la copie. `modulesData.json` et `monitorData.json` sont references dans les binaires, mais absents de l'inventaire fourni. Ces references ne prouvent pas un export periodique disponible.

## 5. Suite envisageable

1. Pour des alertes : approfondir le contenu du message 20 et le routage des destinataires, afin d'evaluer un abonne WCF supplementaire.
2. Pour toutes les mesures : retrouver un contrat local qui exporte l'objet detaille, ou identifier la source du flux XCenter et son comportement. Ne pas utiliser un getter statique dans un autre processus comme substitut a une API.
3. Avant tout test : confirmer la version installee et l'identite des DLL ; la ressource de version du NovaLCT.exe fourni indique 5.4.2101.2901, ce qui ne suffit pas a identifier le numero commercial de l'ensemble.
4. Si un prototype est ensuite autorise : helper C# Windows, identite propre, reception seule ; aucun SendCommand/ExecuteCommand, rafraichissement, verrouillage ou lancement d'un second moteur d'acquisition sans analyse supplementaire.

Aucun prototype actif n'est fourni dans cette phase. La coexistence et l'absence d'effet sur la collecte exigent une validation hors production. Une nouvelle collecte SNMP independante imposerait d'abord le verrou partage host:port prescrit par AGENTS.md.

## Reproductibilite

`tmp/inspect-novalct-metadata.ps1` fonctionne avec Windows PowerShell 5.1 (`powershell.exe`) ou PowerShell 7 (`pwsh.exe`). Sous 5.1, conserver le fichier compagnon `tmp/inspect-novalct-framework.cs` : il utilise ReflectionOnlyLoadFrom de .NET Framework, sans executer le code des assemblies cibles. Sous 7, le lecteur PE/metadonnees reste utilise. Exemple :

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ./tmp/inspect-novalct-metadata.ps1 -AssemblyPath 'NovaLCT/Source/Bin/XcenterBusiness.dll' -Pattern 'XcenterAccessInterface' -OutputPath tmp/novalct-xcenter-il.txt
```

Les sorties sont une lecture de CIL et de noms de symboles, pas une decompilation complete ni une preuve de comportement en production.
