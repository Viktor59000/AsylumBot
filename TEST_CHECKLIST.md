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

## LOT 2 — Roster complet (Arena 6×3, TFT, moteur placement)

### Pré-vol Lot 2
- [ ] `git checkout lot-2-roster` puis `npx prisma migrate deploy` → migration `lot2_placement` appliquée
- [ ] `npx tsc --noEmit` → 0 erreur
- [ ] ⚠️ Le mode Arena a changé de clé (`soloq` → `6x3`) : **supprime l'ancienne catégorie Arena + ses lignes `GameConfig`** si tu l'avais setup avant, puis refais `/setup`.

### A. Setup des nouveaux jeux
- [ ] `/setup` → **LoL Arena** → le mode proposé est **« Arena 6×3 — 6 teams of 3 — ranking 1→6 »** → salon `#arena-6x3` créé
- [ ] `/setup` → **Teamfight Tactics** → modes **Solo (FFA 8)** et **Double Up** en multi-select → salons `#tft-solo` et `#tft-doubleup`
- [ ] RL 1v1/2v2/3v3 : rien n'a bougé (non-régression Lot 1) — un join dans `#rl-1v1` marche toujours

### B. ⭐ Moteur placement en effectif réduit (testable à 2-3 joueurs)
- [ ] 2-3 joueurs rejoignent `#tft-solo` (chacun doit avoir `/ign game:tft` au format `Name#Tag`)
- [ ] `/queue force_start game:tft mode:solo` → ready-check → **PAS de vote de formation** → lobby direct
- [ ] Le lobby liste **une « team » par joueur** (Team 1, Team 2, …) + **un seul salon vocal partagé** (« Lobby ») accessible à tous
- [ ] L'embed du lobby explique le report : `/reportplacement match_id:<id> ranking:...`
- [ ] `/reportplacement match_id:<id> ranking:2,1` (ou `2,1,3` à 3) → embed de résultats avec 🥇🥈 + **Δ Elo par joueur** (le 1ᵉʳ gagne plus que le 2ᵉ, le dernier perd)
- [ ] **Placement partiel** : à 3 joueurs, `ranking:3,1` → Team 2 listée « Unranked (no Elo change) », son Elo n'a pas bougé (`/stats`)
- [ ] Salons supprimés après report, **re-queue immédiat** possible
- [ ] `/leaderboard game:tft mode:solo` affiche le ladder ; `/stats` montre la ligne `solo`

### C. Arena 6×3 (effectif réduit)
- [ ] 2-4 joueurs dans `#arena-6x3` (IGN `game:arena`) → `force_start` → équipes de ≤3 réparties en **≥2 équipes**, **un vocal par équipe** (limite 3), chacun ne peut rejoindre que le sien
- [ ] `/reportplacement` avec le classement des équipes → Elo OK, cleanup OK
- [ ] (Si 18 comptes un jour : pop auto à 18 → 6 équipes de 3 → report 1→6)

### D. Garde-fous & croisements
- [ ] `/reportwin` sur un match placement → refusé avec le message « use /reportplacement »
- [ ] `/reportplacement` sur un match RL/5v5 (tvt) → refusé avec « use /reportwin »
- [ ] `ranking` invalide : équipe inexistante (`9,1`), doublon (`1,1`), une seule équipe (`1`) → messages d'erreur clairs, rien n'est écrit
- [ ] Deuxième `/reportplacement` sur le même match → « already reported »
- [ ] TFT **Double Up** : duo invité (Invite Duo/Trio) → `force_start` à 3-4 joueurs → **le duo est dans la même équipe**
- [ ] Ctrl+C en plein match placement → relance → salons nettoyés, match `abandoned`, re-queue OK

---

## LOT 3 — Matchmaking réel (équilibrage Elo)

### Pré-vol Lot 3
- [ ] `git checkout lot-3-matchmaking` (pas de nouvelle migration) puis `npx tsc --noEmit` → 0 erreur
- [ ] Fabriquer les ratings avec `/mmr user:@x game:rl mode:2v2 action:set amount:<n>` **avant** de lancer la file

### A. ⭐ Équilibrage par Elo — comparer aux valeurs de référence
> L'écart (« gap ») s'affiche dans l'annonce de match (`#in-progress`) : `⚖️ Avg Elo: Team 1 ⭐X vs Team 2 ⭐Y — gap Z`.

| Scénario | Ratings (via /mmr set) | Attendu |
|---|---|---|
| RL **2v2**, 4 solos | 1200 / 1100 / 1000 / 900 | équipes **{1200+900} vs {1100+1000}**, avg 1050/1050, **gap 0** |
| RL **3v3**, 6 solos | 1400 / 1200 / 1100 / 1000 / 900 / 800 | **{1400,1000,800} vs {1200,1100,900}**, avg 1067/1067, **gap 0** |
| RL 3v3, **duo 1400+800** | mêmes ratings, le 1400 invite le 800 | même partition (duo ensemble), **gap 0** |
| RL 2v2, **duo 1200+1100** | 1200/1100/1000/900, les deux hauts en duo | duo **non séparé** → {1200,1100} vs {1000,900}, **gap 200** (l'équilibre parfait est sacrifié au duo — attendu) |
| force_start **impair** (5 joueurs) | 1300/1200/1000/900/800 | split 2v3, **gap ≈ 17** |
| TFT **doubleup** 4 joueurs | 1300/1100/1000/600 | équipes {1300,600} vs {1100,1000} (annonce : ⭐950 vs ⭐1050) |

- [ ] Scénario 2v2 « gap 0 » : la composition affichée correspond (le côté Team 1/Team 2 peut être inversé, c'est normal)
- [ ] Scénario duo 1400+800 : le duo est ensemble ET le gap reste 0
- [ ] Scénario duo 1200+1100 : gap 200 affiché — le duo n'est **jamais** séparé même si ça coûte l'équilibre
- [ ] Vote **Random** : les équipes restent équilibrées ? Non — Random = pas ranked, mais l'équilibrage s'applique quand même (même code) : gap identique au vote Balanced

### B. winStreak / highestRating
- [ ] Gagner 2 matchs de suite avec le même joueur → `/stats` (vue du jeu) : **🔥 Streak: 2**
- [ ] Perdre le 3ᵉ → **Streak: 0**
- [ ] Monter au-dessus de son record (ex. /mmr set 900 puis gagner) → `highestRating` conserve le **plus haut atteint** (visible en base ; l'affichage UI arrive au Lot 5 badges)
- [ ] Placement (TFT) : top moitié = win → streak s'incrémente aussi sur un 1ᵉʳ/2ᵉ sur 4

### C. Non-régression
- [ ] Annonce de match placement : chaque équipe affiche sa moyenne `Team i — ⭐X`
- [ ] Draft (Captains) : le match s'annonce avec les moyennes des équipes **draftées** (pas d'équilibrage — choix humain, attendu)
- [ ] Un cycle complet 2v2 + report + re-queue fonctionne comme avant

---

## LOT 4 — Refonte UX (file enrichie, vocal-gate, report boutons, trackers, bannières)

### Pré-vol Lot 4
- [ ] `git checkout lot-4-ux` puis `npx prisma migrate deploy` → migration `lot4_voice_gate` appliquée
- [ ] `npx tsc --noEmit` → 0 erreur
- [ ] Re-lancer `/setup` sur un jeu déjà configuré : idempotent, ajoute le **« 🔊 Waiting Room »** manquant dans la catégorie

### A. Embed de file enrichi
- [ ] `/set-profile` (rôle déclaré) + `/ign`, puis rejoindre une file → chaque ligne montre : `@joueur — <rôle> • ⭐<elo> (<rang>)`
- [ ] Barre de progression `▰▰▱…` + compteur **X/N** dans la description ; passe à « 🔔 Queue full! » quand plein
- [ ] Être **en vocal** en rejoignant → **🔊** apparaît sur sa ligne (l'embed permanent se rafraîchit tout seul, throttle 2 s)
- [ ] Inviter un duo → **👥¹** sur les deux lignes

### B. ⭐ Report par boutons (tvt) — le flux sécurisé
- [ ] Lancer un match RL 1v1/2v2 → message épinglé **« 🏁 Result report »** avec `Team 1 won` / `Team 2 won`
- [ ] Un **non-participant** clique → refusé (« Only match participants... »)
- [ ] Un participant clique « Team 1 won » → passe en attente : boutons **Confirm / Contest**
- [ ] Un joueur de la **même équipe** clique Confirm → refusé (« opposing team »)
- [ ] Un joueur de l'équipe **adverse** clique Confirm → résultat validé : embed Elo dans le lobby, **posté dans `#match-history`**, **log dans `#inhouse-admin-logs`**, salons supprimés, re-queue OK
- [ ] Refaire un match → **Contest** → log admin « Result contested », boutons re-proposés, un admin peut trancher (bouton ou `/reportwin`)
- [ ] `/reportwin` est désormais **réservé admin** (invisible pour un joueur normal)

### C. Report par positions (placement)
- [ ] TFT solo force_start à 2-3 → message épinglé avec **select « Report YOUR team's position »**
- [ ] Chaque joueur choisit sa position ; deux équipes sur la même position → refus (« already claimed »)
- [ ] Quand toutes les équipes ont choisi → **finalisation auto** (Elo + history + logs + cleanup)
- [ ] Variante : seulement 2 équipes sur 3 choisissent → bouton **« Finalize now (admin) »** valide le partiel (admin only)

### D. Vocal-gate + auto-move + pénalité no-show
- [ ] `/config game:rl mode:1v1 voice_gate:true` → confirmé « Voice gate: ON 🔊 »
- [ ] File pleine → **Accept hors vocal refusé** (« connect to a voice channel ») ; se mettre dans le Waiting Room → Accept passe
- [ ] Au lancement : les joueurs **déjà en vocal sont déplacés automatiquement** vers leur salon d'équipe
- [ ] Laisser expirer / refuser un ready-check → **queue-ban 5 min** (DM reçu) + **log admin** ; re-join refusé (« Suspended until... ») ; récidive dans les 24 h → **15 min**
- [ ] `voice_gate:false` → l'accept hors vocal remarche (opt-in réel)

### E. Liens trackers à l'/ign
- [ ] `/ign game:lol pseudo:Faker#KR1` → réponse avec liens **OP.GG / U.GG** cliquables (région du serveur)
- [ ] `/ign game:valorant pseudo:Name#Tag` → lien **Tracker.gg** ; `game:tft` → **tactics.tools/MetaTFT** ; `game:rl` → recherche RL Tracker
- [ ] Aucune clé API requise pour ces liens (la clé Riot en `.env` servira au module preview, lot ultérieur)

### F. Bannières par jeu/mode
- [ ] Sans assets : les embeds gardent l'image placeholder, **aucun crash**
- [ ] Déposer `assets/rocket_league/queue_banner_1v1.png` → l'embed de la file **rl-1v1** l'utilise (et pas la 2v2)
- [ ] Déposer `assets/rocket_league/queue_banner.png` → utilisé par les autres modes RL (fallback jeu)

### G. Non-régression
- [ ] Cycle complet 2v2 : join → pop → vote → match → report boutons → history → re-queue
- [ ] Ctrl+C en plein match → relance → cleanup, `abandoned`, re-queue (les claims de report en cours sont perdus au restart : re-cliquer, comportement attendu)

---

## LOT 5 — Engagement (rush hours, saisons, challenges, badges)

### Pré-vol Lot 5
- [ ] `git checkout lot-5-engagement` puis `npx prisma migrate deploy` → migration `lot5_engagement`
- [ ] `npx tsc --noEmit` → 0 erreur
- [ ] ⚠️ Comprendre le modèle : tes ratings actuels vivent « hors saison » (`seasonId null`). Au premier `/season start`, les ladders repartent à 1000 — **sauf** avec `soft_reset:true` qui ressème depuis l'existant (à mi-chemin de 1000).

### A. ⭐ Saisons complètes
- [ ] `/season start name:"Season 1" soft_reset:true` → confirme « X rating(s) seeded » ; un joueur qui était à 1200 est maintenant à **1100** (`/stats`)
- [ ] `/season start` à nouveau → refus « Season 1 is still active »
- [ ] Jouer un match → l'Elo bouge sur la saison active ; `/leaderboard` n'affiche **que** la saison active
- [ ] Jouer **3+ matchs** avec 2 joueurs (min. requis pour les récompenses) puis `/season end` → embed **podium par ladder** : 🥇/🥈 + coins (200/100) ; `/stats` → badge **🏆 Season Champion** visible, l'ancienne saison apparaît dans **📜 Season History**
- [ ] Après `end` : plus de saison active → `/season start name:"Season 2"` (sans soft reset) → tout le monde re-part à 1000

### B. ⭐ Rush hours
- [ ] `/event rushhour duration:10 multiplier:2` → dans la minute, **annonce 🔥 RUSH HOUR** dans tous les salons de file
- [ ] Reporter un match pendant le créneau → le **gagnant** gagne ×2 (marqué 🔥 dans l'embed), le **perdant perd le montant normal** (non doublé — voulu)
- [ ] Les coins de challenges gagnés pendant le créneau sont ×2 (marqué 🔥×2 dans le DM)
- [ ] `/event rushhour duration:10 multiplier:2 game:rl` → l'annonce ne part que dans les salons RL ; un report LoL pendant ce créneau n'est **pas** boosté
- [ ] `/event list` montre actif/planifié ; `/event cancel id:<X>` → annonce de fin dans la minute
- [ ] Fin naturelle du créneau → annonce « Rush hour ended » (une seule fois, même après restart)

### C. Challenges étendus
- [ ] `/challenges` affiche : Daily (3 joués / 1 gagné), **Weekly (10 joués +150 / 5 gagnés +100)**, **première victoire du jour par jeu (+25)** et le solde
- [ ] Gagner son premier match du jour sur un jeu → DM « 🌟 First win of the day » +25 ; re-gagner le même jour sur le même jeu → pas de re-bonus ; sur un **autre jeu** → nouveau +25
- [ ] Le compteur weekly survit au reset daily (minuit UTC) et se remet à zéro le lundi

### D. Badges & rangs visuels
- [ ] 5 victoires d'affilée sur un ladder → badge **🔥 On Fire** dans `/stats` (une fois par jeu/mode)
- [ ] `/leaderboard` : chaque ligne porte l'emoji de tier (🟫⬜🟨🟦💎) selon l'Elo

### E. Non-régression
- [ ] Cycle complet (join → pop → report boutons → history) inchangé hors rush hour (Δ Elo standards, pas de 🔥)
- [ ] Ctrl+C pendant un rush hour actif → relance → pas de double annonce, multiplicateur toujours actif jusqu'à la fin du créneau

---

## Comment reporter un bug ici
Copie dans le chat : (1) ce que tu as fait, (2) ce qui était attendu, (3) ce qui s'est passé, (4) les **logs console** au moment du bug (masque tout secret). Je corrige avant de passer au lot suivant.
