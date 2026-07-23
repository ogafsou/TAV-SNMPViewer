# Procédure 2MC — « To Machine Cible »

## Objectif

La procédure **2MC** prépare un répertoire de transfert destiné à une machine cible
qui ne dispose pas d’un accès à Internet.

Lorsque l’utilisateur demande « fais-moi un 2MC », le contenu de `./2MC` doit
permettre une copie directe à la racine du projet installé sur la machine cible.

## Point de synchronisation

- Le premier point de synchronisation correspond à l’état du projet au moment où
  cette procédure est initialisée.
- Le point courant est enregistré dans `./Codex/2MC_sync_point.json`.
- Un point de synchronisation représente l’état de référence des fichiers après le
  dernier 2MC.
- La détection doit porter sur les changements intentionnels du projet : fichiers
  ajoutés ou modifiés depuis ce point.
- Les fichiers générés à l’exécution — logs, caches, fichiers temporaires, médias de
  test et dépendances installées — ne sont pas des modifications à transférer, sauf
  demande explicite.
- Le répertoire `./2MC` lui-même et le fichier de suivi
  `./Codex/2MC_sync_point.json` ne font jamais partie des fichiers à transférer.

## Exécution d’un 2MC

Lorsqu’un 2MC est demandé :

1. Lire `./Codex/2MC_sync_point.json` pour retrouver le dernier point.
2. Identifier tous les fichiers du projet ajoutés ou modifiés intentionnellement
   depuis ce point.
3. Identifier également les suppressions éventuelles. Une suppression ne peut pas
   être représentée par une copie : elle doit donc être signalée dans le fichier
   d’instructions du paquet.
4. Vider entièrement `./2MC` avant de préparer le nouveau paquet.
5. Copier dans `./2MC` tous les fichiers ajoutés ou modifiés, en conservant leur
   chemin relatif depuis la racine du projet.

Exemple :

```text
Fichier source :
./TAV_Monitoring_Backend/public/javascripts/app.js

Copie 2MC :
./2MC/TAV_Monitoring_Backend/public/javascripts/app.js
```

Ainsi, le contenu de `./2MC` peut être copié directement à la racine du projet de
la machine cible.

## Exception pour les fichiers de configuration

Un fichier de configuration propre à l’installation cible ne doit pas être
remplacé automatiquement.

Sont notamment concernés :

- le `config.json` principal ;
- les `machines.json`, `users.json`, etc... ;
- les fichiers de configuration spécifiques à une machine ou à un environnement ;
- tout fichier contenant des chemins, ports, identifiants ou réglages propres à
  l’installation cible.

Lorsqu’un tel fichier a changé :

1. Ne pas copier le fichier de configuration complet dans `./2MC`.
2. Prévenir explicitement l’utilisateur dans le compte rendu du 2MC.
3. Créer ou compléter :

```text
./2MC/MODIFICATIONS_CONFIG_2MC.txt
```

4. Y indiquer, pour chaque changement :
   - le chemin du fichier concerné ;
   - la clé ou la section à modifier ;
   - l’ancienne valeur si elle est connue ;
   - la nouvelle valeur à appliquer ;
   - toute instruction de redémarrage nécessaire.

Le fichier d’instructions doit permettre une modification manuelle non ambiguë sur
la machine cible.

## Suppressions

Les fichiers supprimés depuis le dernier point sont listés dans
`MODIFICATIONS_CONFIG_2MC.txt`, dans une section distincte intitulée
`FICHIERS À SUPPRIMER SUR LA MACHINE CIBLE`. Aucune suppression n’est effectuée
automatiquement sur la machine cible.

## Validation du paquet

Avant de terminer :

1. Vérifier que chaque fichier transférable attendu existe dans `./2MC`.
2. Vérifier que son arborescence relative est identique à celle du projet.
3. Vérifier qu’aucun fichier de configuration cible complet n’a été copié.
4. Vérifier que toutes les adaptations de configuration et suppressions sont
   décrites dans `MODIFICATIONS_CONFIG_2MC.txt`.
5. Fournir à l’utilisateur un résumé :
   - nombre de fichiers copiés ;
   - liste des fichiers de configuration à adapter ;
   - liste des suppressions à effectuer ;
   - éventuels services ou applications à redémarrer.

## Nouveau point de synchronisation

Une fois le paquet 2MC préparé et validé :

1. Mettre à jour `./Codex/2MC_sync_point.json`.
2. Incrémenter le numéro du point.
3. Enregistrer la date et l’heure du nouveau point.
4. Considérer l’état courant du projet comme nouvelle référence.

La création du paquet et l’avancement du point de synchronisation constituent une
seule opération : un 2MC terminé définit toujours le nouveau point.

## Règle de prudence

En cas d’incertitude sur le caractère généré, transférable ou spécifique à la
machine d’un fichier, ne pas l’omettre silencieusement : le signaler à l’utilisateur
avant de finaliser le paquet.
