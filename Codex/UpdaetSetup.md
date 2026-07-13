# Etapes de mise à jour de l'onglet Configuration
Ce fichier décrit les modifications à apporter à l'oinglet Configuration quand on ajoute ou edite  un équipement
Cette liste d'étapes et à executer ans l'ordre suivant

## Etape 1 - Suppression de "Modele"
Il faut supprimer "Modele" de l'interface de crétaion. Cette valeur sera récupérée directement par l'équipement lors des récupérations d'informations

## Etape 2 - "Paramètres avancés"
Dans le popup de cr"ation / édition d'une machine, je veux regrouper les paramètres avancés dans une section dédiée qui puisse etre Collapse / Expand.
Le paramètres à afficher parr défaut sont :Nom, adresse IP, Utilisateur API, Mot de Passe API, Sources des Infos (SNMP ou API). Tout le reste doit se trouver dans cette section "Paramètres avancés".

## Etape 3 - SNMP + API 
Je voudrais pouvoir choisir dans Sources des Infos entre SNMP, API ou SNMP + API. Ce 3ème mode permet de récupérer les infos via SNMP et API en conservant les meilleures infos des 2 modes.

## Etape 4 - Masquage éléments non pertinents
Dans ce popup de configuration, je vuodrais que seuls les éléments en rapport avcec le mode (SNMP, API, ou SNP + API) ne soient visibles, par exemple Lecture et écriture ne doivent être visibles que si le mode est SNMP ou SNMP + API

## Etape 5 - Ajout d'autres types de machines
Je voudrais ajouter un champs Type, qui doit se trouver avant le nom, et qui est une dropdown qui peut avoir (pour l'instant) les valeurs  "Novastar H" , "Kiloview" ou "Autres".
Quand on modifie le type, les champs du popupo se metttent à jour:
- Si on choisit Novastar, on a exactement ce qui est présent actuellement 
- Si on choisit Kiloview, on garde alors Nom, IP, utilisateur, et mot de passe
- Si on choisit Autres, on garde alors seulement Nom et IP

D'un point de vue fonctionnalités:
- Quand on choisit "Novastar H", on conserve le fonctionnement actuel (récupération des infos via SNMP et/ou API), si
- Quand on choisit "Autres" on vérifie seulement la présence de la machine via un ping
- Quand on choisit "Kiloiew",pourl'instant on vérifie seulement la présence de la machine via un ping, mais on va intégrer rapidement une vérification plus avancée via API
