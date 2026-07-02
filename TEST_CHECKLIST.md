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

## LOT 1 — Multi-mode + Party/Duo

### Pré-vol Lot 1 (obligatoire — sinon fausses anomalies)
- [ ] `git checkout lot-1-multimode` puis `npx prisma migrate deploy` → migration `lot1_multimode` appliquée
- [ ] `npx tsc --noEmit` → 0 erreur (confirmation locale)
- [ ] **Setup propre** : serveur vierge, OU supprimer les anciennes catégories/salons ET les lignes `GameConfig` du Lot 0 (`mode:"Ranked"` = ancien sens)
  - *si tu testes par-dessus l'ancien setup* : boutons legacy sans mode + configs fantômes → incohérences qui ne sont PAS des bugs du Lot 1.

### A. Setup multi-mode
- [ ] `/setup` → **Rocket League** → étape « Select Queue Modes » en **multi-select** → cocher **1v1 + 2v2** → région → confirm
- [ ] Salons créés : `#rl-1v1` et `#rl-2v2`, chacun avec son message de file à boutons (Join/Leave ; **pas de bouton Invite en 1v1**)
- [ ] `#top-20` contient **2 messages leaderboard** (un par mode) avec chacun son bouton Refresh
- [ ] Cliquer **Join** dans `#rl-1v1` → seul l'embed de `#rl-1v1` se met à jour (pas le 2v2)

### B. ⭐ Parallélisme (LE test du Lot 1)
- [ ] Remplir la file **1v1** (2 joueurs) et la file **2v2** (4 joueurs) quasi en même temps
- [ ] **Deux ready-checks simultanés** apparaissent, chacun dans son salon, mentions correctes
- [ ] Accepter les deux → **deux votes simultanés** → **deux matchs/lobbies simultanés** sans mélange de joueurs
- [ ] Reporter les deux matchs → chaque Elo est crédité sur le **bon ladder** : `/stats` montre des lignes séparées `1v1` et `2v2`, `/leaderboard game:rl mode:1v1` ≠ `mode:2v2`
  - *si ça casse (états croisés)* : ré-indexation par session en cause → me copier les logs + customIds des boutons.

### C. Party/Duo (réparé au Lot 1)
- [ ] Dans une file ≥ 2v2 : **Invite Duo/Trio** → le menu de sélection de joueur s'ouvre (plus de « interaction failed »)
- [ ] Un **autre** joueur que l'invité clique Accept → refusé (« pas pour toi ») ; l'invité clique → il rejoint le groupe
- [ ] Lancer le match (vote Balanced ou Random) → **le duo est dans la même équipe** — répéter **2-3 fois**
- [ ] Inviter au-delà de la taille d'équipe (ex. 3ᵉ joueur dans un groupe en 2v2) → refus « groupe complet »

### D. Cas limites
- [ ] RL **1v1** en vote **Captains** → le match se finalise directement (pas de draft bloqué)
- [ ] `/queue force_start game:rl mode:2v2` → pop la bonne file uniquement
- [ ] `/mmr user:@x game:rl mode:1v1 action:add amount:50` → seul le ladder 1v1 bouge
- [ ] Non-régression Lot 0 : **Ctrl+C en plein match** → relance → cleanup + `abandoned` + re-queue OK

---

## Comment reporter un bug ici
Copie dans le chat : (1) ce que tu as fait, (2) ce qui était attendu, (3) ce qui s'est passé, (4) les **logs console** au moment du bug (masque tout secret). Je corrige avant de passer au lot suivant.
