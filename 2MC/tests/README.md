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

## Test des traps NovaStar sans snmptrapd

Valider localement le récepteur :

```powershell
npm run test:trap
```

Écouter ensuite le NovaStar `192.168.69.86` sur un port non privilégié :

```powershell
$env:NOVASTAR_IP="192.168.69.86"
$env:TRAP_PORT="1162"
npm run listen:novastar-traps
```

Sous Cygwin :

```sh
NOVASTAR_IP=192.168.69.86 TRAP_PORT=1162 npm run listen:novastar-traps
```

Configurer la destination des traps du NovaStar avec l'adresse du PC et le
port `1162`. Le port UDP 1162 doit être autorisé dans le pare-feu Windows.
