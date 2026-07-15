# Tests d'architecture

La suite valide sans contacter les equipements reels :

- la presence de deux applications independantes ;
- le CRUD REST et le masquage des secrets ;
- les scans forces et le snapshot de monitoring ;
- les references conservees par le backend ;
- les messages WebSocket complets et legers ;
- le proxy REST/WebSocket du frontend EJS.

Depuis la racine du projet :

```powershell
node tests\run.js
```
