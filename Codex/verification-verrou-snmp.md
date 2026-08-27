# Vérification du verrou SNMP — Backend.log du 16 août 2026

## Résultat

Le verrou de scan par agent NovaStar est validé sur le réseau.

### Même agent `192.168.69.86:161`

- ancien identifiant : `1786873015364` ;
- nouvel identifiant : `1786877094376` ;
- ancien verrou acquis à `10:43:50.255` ;
- nouveau verrou demandé à `10:44:54.813`, pendant l'ancien scan ;
- ancien verrou libéré à `10:45:03.928` avec `active:0` et
  `outcome:completed` ;
- nouveau verrou acquis à `10:45:03.929`, soit 1 ms après la libération ;
- attente mesurée du nouveau scan : `waitedMs:9116` ;
- nouveau verrou libéré à `10:46:04.452` avec `active:0` et
  `outcome:completed`.

Il n'existe donc aucun chevauchement entre les deux identifiants visant le même
agent.

### Agents différents

- `192.168.69.86:161` est détenu de `10:43:50.255` à `10:45:03.928` ;
- `192.168.69.85:161` est détenu de `10:43:50.314` à `10:45:06.806`.

Ces intervalles se chevauchent pendant plus de 73 secondes. Le verrou ne bloque
donc pas globalement les NovaStar différents.

### Contrôles complémentaires

- toutes les acquisitions observées contiennent `active:1` ;
- toutes les libérations observées contiennent `active:0` ;
- aucune valeur `active:2` n'est présente ;
- toutes les opérations terminées ont `outcome:completed` ;
- aucune échéance `worker tick skipped` n'est présente dans ce journal ;
- aucune opération `trap-configuration` n'a été mise en concurrence pendant
  cette capture ; son partage avec les scans reste couvert par le test
  automatisé.

## Défaut de journalisation corrigé

Dans ce fichier historique, `lockKey` apparaît comme `[redacted]`. Le filtre de
secrets interprétait à tort le suffixe `Key` de `lockKey` comme une donnée
sensible. La règle a été resserrée : les prochains logs montreront la paire
`host:port`, tout en continuant à masquer mots de passe, communautés, tokens et
clés réellement sensibles.
