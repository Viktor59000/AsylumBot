# TEST CHECKLIST — validation par lot

Serveur Discord de **test** (vide), bot lancé avec `npm run dev`. Coche au fur et à mesure. Si un point casse, regarde la colonne « si ça casse ».

---

## Pré-vol (une fois)
- [ ] `npx prisma migrate deploy` → « All migrations have been successfully applied » ✅ (fait)
- [ ] `npm run dev` → logs : `Logged in as <bot>!` + `Successfully reloaded application (/) commands.`
  - *si ça casse* : `TokenInvalid` → token ; `disallowed intents` → active Server Members Intent dans le portail.
- [ ] Aucun crash au démarrage, un log de recovery s'affiche (ex. « recovery: 0 matchs abandonnés »).

---

## LOT 0 — Socle & résilience 24/7

### A. Cycle de match complet (le cœur)
- [ ] `/setup` → choisir **Rocket League** → la catégorie créée s'appelle bien **`InHouse - Rocket League`** (pas LoL)
  - *si ça casse (LoL)* : tu n'es pas sur un serveur vierge → d'anciens salons existent. Refais sur serveur propre.
- [ ] Dans le salon de file : cliquer **Join** → le message de file **se met à jour tout seul** (compteur +1) sans refaire la commande
  - *si ça casse* : `queueMessageId` non posé → vérifier logs `[startup] Bound X game config(s)`.
- [ ] Remplir la file (ou `/queue force_start` en admin) → **le ready-check apparaît** avec mentions des joueurs (pas un `<@&...>` cassé)
  - *si ça casse (rien ne pop)* : channel non lié → log `[queueFull] No channel bound`.
- [ ] Accepter le ready-check → phase de **vote** → choisir un mode
- [ ] Le **lobby** se crée : salon texte privé + salons vocaux
- [ ] **Rejoindre son salon vocal d'équipe** fonctionne (accès non verrouillé) ✅ *(bug P0-3)*
- [ ] `/reportwin match_id:<id> winning_team:team1` → embed résultat + **Elo mis à jour**
- [ ] Les **salons du match sont supprimés** après le report
- [ ] **Re-queue immédiat** : rejoindre à nouveau la file marche tout de suite ✅ *(bug P0-2 — le plus important)*

### B. Résilience au crash (le test qui prouve le Lot 0)
- [ ] Relancer un match, puis **`Ctrl+C`** en plein match → log d'**arrêt gracieux** (timers annulés, `prisma disconnect`)
- [ ] Relancer `npm run dev` → au boot : les **salons du match orphelin sont supprimés**, le match passe **`abandoned`**, et **tout le monde peut re-queue**
  - *si ça casse* : vérifier `RecoveryManager` au `ready`.

### C. Cas limites rapides
- [ ] `/cancel match_id:<id>` sur un match en cours → salons supprimés, match `cancelled`, joueurs re-queue OK
- [ ] `/reportwin` sur un match déjà `cancelled`/`abandoned` → refusé proprement
- [ ] Deux joueurs, l'un lance `/setup` l'autre non → seul l'admin peut `/setup` (permissions)

---

## LOT 1 — Multi-mode (à tester quand il sera codé)
- [ ] `/setup` propose de choisir plusieurs **modes** → un salon de file par mode créé
- [ ] Deux files du **même jeu** peuvent pop **en même temps** sans se mélanger
- [ ] RL **1v1 / 2v2 / 3v3** ont chacun leur salon **et leur Elo séparé**
- [ ] `/stats` montre l'Elo par (jeu, mode)

---

## Comment reporter un bug ici
Copie dans le chat : (1) ce que tu as fait, (2) ce qui était attendu, (3) ce qui s'est passé, (4) les **logs console** au moment du bug (masque tout secret). Je corrige avant de passer au lot suivant.
