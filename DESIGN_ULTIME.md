# DESIGN — AsylumBot « Version Ultime »

Blueprint produit + technique de la cible. Complète `AUDIT_ASYLUMBOT.md` (état actuel) et `TASKS.md` (correctifs). Objectif : spécifier assez précisément l'UX, les modes, les événements et le site web pour qu'une IA de code (Claude Code / Codex) les implémente sans deviner.

## 0. Décisions actées

- **Principe directeur — « zéro-admin après le setup »** : l'admin lance `/setup` **une seule fois** pour déployer le bot ; ensuite **tout est self-service pour les joueurs via des boutons**, sans intervention admin pour le quotidien (rejoindre, jouer, reporter, voir ses stats). Les slash-commands admin restent réservées aux cas exceptionnels (annulation forcée, sub, sanctions). Voir §6.4.
- **Modes de file** : tous (SoloQ, DuoQ/groupes, Premade full-team, Scrims), avec **salons dédiés par mode**.
- **Rôles** : **indicatifs** — déclarés par le joueur, affichés dans le lobby, mais l'équilibrage reste **Elo pur** (pas de contrainte de composition en v1).
- **Site web de stats** : **dans le périmètre, maintenant** (profils, ladder, historique), branché sur la même base + login Discord.
- **Engagement** : **tout** — rush hours (points ×2), saisons + récompenses, challenges quotidiens/hebdo, leaderboards live + badges.
- **Jeux & formats** : LoL, Valorant, CS2, R6, Rocket League (**1v1 / 2v2 / 3v3**), **LoL Arena (6 équipes de 3)**, et **TFT (Solo 8 joueurs + Double Up en 4 équipes de 2)**.

---

## 1. Matrice par jeu

Référence unique pour `constants.ts` / `GameConfig`. Le socle actuel a des valeurs incohérentes (RL en teamSize 3, arena mal cadré) — voici la cible.

| Jeu | Type | Format(s) | Joueurs/file | Rôles (indicatifs) | Veto | Side | Intégration | Lobby spécifique |
|-----|------|-----------|--------------|--------------------|------|------|-------------|------------------|
| **League of Legends** | TvT | 5v5 | 10 | Top, Jungle, Mid, ADC, Support | ❌ | ❌ | OP.GG multisearch + lien draft | Draft Captains + liens |
| **Valorant** | TvT | 5v5 | 10 | Duelist, Initiator, Controller, Sentinel | ✅ | ✅ (Atk/Def) | Tracker.gg (ou retirer la promesse) | Veto + side |
| **CS2** | TvT | 5v5 | 10 | — (IGL optionnel) | ✅ | ✅ (CT/T) | — (connect string configurable) | Veto + side + connect |
| **Rainbow Six Siege** | TvT | 5v5 | 10 | — (Atk/Def loose) | ✅ | ✅ | — | Veto + side |
| **Rocket League** | TvT | **1v1 / 2v2 / 3v3** | 2 / 4 / 6 | — | ❌ | ❌ | — | Nom + mot de passe de match privé |
| **LoL Arena** | Placement | **6 équipes de 3** | 18 | — | ❌ | ❌ | — | 6 salons vocaux, report par classement 1→6 |
| **TFT (Solo)** | Placement | **FFA 8 joueurs** | 8 | — | ❌ | ❌ | (Tactics.tools/MetaTFT opt.) | 1 salon, report par placement 1→8 |
| **TFT (Double Up)** | Placement | **4 équipes de 2** | 8 | — | ❌ | ❌ | (Tactics.tools/MetaTFT opt.) | report par classement d'équipe 1→4 |

Notes :
- Colonne **Type** : `TvT` = 2 équipes, résultat binaire gagnant/perdant ; `Placement` = N participants classés 1→N (voir §1bis pour le report et l'Elo).
- **Rocket League** : proposer les 3 formats **comme modes distincts** (salons `#rl-1v1`, `#rl-2v2`, `#rl-3v3`) — chacun a son propre Elo (l'Elo 1v1 ≠ 3v3, comme dans le vrai RL). file pleine = `teamSize × 2`.
- **teamSize configurable** par serveur via `/config`.
- **LoL Arena = 6 équipes de 3** (18 joueurs) : file pleine à 18, création de 6 salons vocaux (limite 3), report par classement. *(NB : le mode Arena officiel de Riot est en équipes de 2 — le format 6×3 est spécifique à ton inhouse ; garder le nombre d'équipes et la taille **paramétrables** si tu veux basculer plus tard.)*
- **TFT** : jeu de placement pur (pas d'équipes en Solo). En **Double Up**, 4 duos ; le placement d'équipe donne l'Elo aux deux joueurs.

### §1bis — Types de match : TvT vs Placement

Deux moteurs de résultat/Elo cohabitent. C'est structurant pour le report, le modèle de données et l'Elo.

| | **TvT** (LoL, Valo, CS2, R6, RL) | **Placement** (Arena, TFT) |
|--|--------------------------------|-----------------------------|
| **Résultat** | 1 équipe gagnante | classement ordonné 1→N (équipes ou joueurs) |
| **Report** | bouton « Team X a gagné » + confirmation (P2-1) | saisie du classement : soit chaque équipe/joueur clique sa position, soit l'hôte ordonne la liste |
| **Elo** | `calculateNewRating` par équipe (déjà là, à équilibrer) | Elo par **placement** : le champ gagne, les derniers perdent, dégradé selon le rang (ex. multi-joueurs : `Δ = K × (placementAttendu − placementRéel)` normalisé) |
| **Modèle** | `Match.winner` = team1/team2 | `MatchPlacement(matchId, teamKey, position)` ou `MatchPlayer.placement` |

Action de conception : introduire un champ **`matchType`** (`tvt` / `placement`) sur `GameConfig`/`Match`, et une **stratégie de report + une formule d'Elo par type**. Les stratégies de jeu (`GameStrategy`) héritent du bon moteur selon le type.

---

## 2. Architecture des files & salons (modes)

### 2.1 Principe : un salon de file par (jeu, mode) actif

Chaque jeu configuré via `/setup` crée une **catégorie** ; dedans, un **salon de file par mode activé**, plus les salons annexes. Exemple pour LoL :

```
InHouse — League of Legends            (catégorie)
├─ #lol-soloq        (file SoloQ + DuoQ)         [queue message permanent + boutons]
├─ #lol-premade      (file d'équipes 5 pré-faites) [optionnel]
├─ #lol-scrims       (défis d'équipe)              [optionnel]
├─ #lol-match-history (résultats auto)
├─ #lol-top          (leaderboard live auto-édité)
└─ #lol-admin-logs   (privé)
Ongoing LoL Games                       (catégorie)
└─ #lol-in-progress  (matchs live + spectate)
ASYLUM MATCHES                          (catégorie, salons éphémères de match)
```

`/setup` évolue pour demander **quels modes activer** (multi-select) et créer un salon de file par mode. La table `GameConfig` passe à une granularité **(guildId, game, mode)** — voir §8.

### 2.2 Comportement par mode

| Mode | File | Composition des équipes | Ranked ? | Salon |
|------|------|-------------------------|----------|-------|
| **SoloQ** | individuelle | équilibrage Elo pur | ✅ | `#<jeu>-soloq` |
| **DuoQ/groupes** | mixte solo + groupes (le `groupId` existe) | groupes gardés ensemble, complétés par des solos, puis équilibrage Elo | ✅ | même salon que SoloQ (groupes ≤ teamSize−1) |
| **Premade** | par équipe complète (clan ou groupe de teamSize) | équipe = telle quelle, appariée à une autre équipe de même effectif | ✅ (Elo d'équipe séparé, voir §8) | `#<jeu>-premade` |
| **Scrims** | défi programmé A vs B | 2 équipes déclarées | ⚙️ optionnel | `#<jeu>-scrims` + commande `/scrim` |

Règles clés à implémenter :
- **DuoQ** : au `queueFull`, l'algo d'équilibrage (§4) place chaque `groupId` entièrement dans une seule équipe avant de répartir les solos. Refuser un groupe > `teamSize−1` (sinon impossible d'équilibrer).
- **Premade** : ne « pop » que quand **deux** équipes complètes sont en file (ou une équipe + un défi). Pas de ready-check individuel : check par capitaine.
- **Scrims** : `/scrim challenge @équipe date` → l'autre capitaine accepte → création directe du lobby à l'heure dite (rappel automatique).

---

## 3. Système de rôles (indicatif)

- Déclaration via le wizard de profil (`/set-profile`) et/ou `/ign` : pour LoL/Valo, stocker rôle principal + secondaire dans `UserIgn.preferences` (JSON, déjà prévu).
- **Affichage** : dans le lobby et l'annonce de match, montrer le rôle à côté de chaque joueur (ex. `Top — Faker`). Aucune contrainte sur la composition.
- **Pré-câblage v2** : garder la structure prête pour un futur « matchmaking par rôle » (l'algo §4 lit déjà les rôles), mais ne pas l'activer.
- Emojis de rôle personnalisés (assets serveur) pour une lecture visuelle rapide.

---

## 4. Matchmaking & équilibrage

Remplacer le `sort(() => 0.5 - Math.random())` actuel (aléatoire pur) par un équilibrage Elo réel :

1. **Constituer les unités** : chaque `groupId` = 1 unité (somme/moyenne d'Elo), chaque solo = 1 unité.
2. **Répartition** : trier les unités par Elo décroissant, puis affectation gloutonne « à l'équipe la plus faible » (ou recherche de la meilleure partition minimisant |ΔElo moyen|).
3. **Contraintes** : respecter les groupes (indivisibles), respecter `teamSize`.
4. **Sortie** : afficher l'écart d'Elo moyen entre équipes dans l'annonce (transparence).
5. **Rôles** : lus mais non contraignants (v1).

Elo (à compléter dans `EloManager.updateElo`) : mettre à jour `winStreak` (incrément/reset) et `highestRating = max(...)`, aujourd'hui jamais écrits. K-factor éventuellement variable (plus élevé sur les premiers matchs = calibration).

---

## 5. Système d'événements & engagement

### 5.1 Rush hours (points ×2)
- Table `Event` (ou config) définissant des créneaux (cron ou plages horaires UTC) avec un **multiplicateur** d'Elo et/ou de coins.
- Au report, `EloManager`/`ChallengeManager` appliquent le multiplicateur si `now` est dans une rush hour active.
- Annonce automatique au début/fin du créneau dans un salon d'annonces + bannière dédiée.
- Admin : `/event rushhour start|schedule` (créneau, multiplicateur, portée jeu/tous).

### 5.2 Saisons + récompenses
- `/season start` (manquant) crée une saison **active** ; `Match` et `Elo` sont liés à la saison active (aujourd'hui `seasonId` toujours null — à corriger partout).
- `/season end` : archive, distribue les **récompenses** (rôles Discord, badges) selon le ladder final, option de **soft reset** (rapprochement vers la moyenne plutôt que reset brutal à 1000).
- Historique de saison déjà affiché dans `/stats` → se remplira correctement une fois le lien saison branché.

### 5.3 Challenges quotidiens / hebdomadaires
- Étendre `ChallengeManager` (aujourd'hui : 3 matchs joués + 1 gagné → coins) : ajouter des défis hebdo, des paliers, des défis par jeu.
- **Corriger** la fuite de timers (instancié à chaque report) et le reset non-idempotent → cron unique UTC (voir TASKS P1-3/P1-5).
- Récompenses en coins → boutique (rôles cosmétiques déjà en place).

### 5.4 Leaderboards live + badges
- Leaderboard en **message permanent édité** (stocker `leaderboardMessageId`), filtré par **saison active**, boutons tri/pagination persistants.
- **Rangs visuels** (Bronze→Diamond, déjà calculés) avec bannières/emblèmes par palier.
- **Badges** : saison gagnée, top 3, win-streak, participation rush hour — stockés en base, affichés dans `/stats` et sur le site.

---

## 6. UX/UI Discord

Objectif : chaque étape = un embed soigné, une bannière contextuelle, des boutons clairs, un seul message qui se met à jour (pas de spam).

### 6.1 Bannières (AssetManager)
- Le système d'assets existe (`AssetManager` : gif > png > jpg, par jeu + fallback global). À **peupler** : `assets/<jeu>/queue_banner`, `live_banner`, `rank_banner`, `win_banner`, + `assets/global/` par défaut.
- Ajouter des bannières par **mode** et par **événement** (rush hour) : `queue_banner_soloq`, `event_rushhour`, etc.
- Nommage : minuscules, tirets (cohérent avec tes conventions).

### 6.2 Flux joueur cible (SoloQ LoL)
1. **Salon de file** : embed permanent (bannière, compteur X/10, liste 2 colonnes, groupes marqués) + boutons **Join / Leave / Duo**. Auto-édité à chaque changement (throttle).
2. **Ready-check** : embed 60 s, boutons Accept/Decline, cases ✅/⬜, pénalité auto si dodge (§5/P2-4).
3. **Vote de mode** : barres de progression (déjà là), 30 s.
4. **Lobby** : salon texte privé + bannière live + rôles affichés + liens (OP.GG/draft) + salons vocaux **accessibles** (P0-3) + boutons **Report / Cancel** fonctionnels (P2-1).
5. **Annonce** dans `#in-progress` : embed live + bouton **Spectate** + écart d'Elo.
6. **Résultat** : embed dans `#match-history` (Δelo par joueur, carte), leaderboard mis à jour, salons nettoyés (P0-4).

### 6.3 Cohérence
- Une seule charte de couleurs (déjà : `ASYLUM_GOLD`), typo/emojis homogènes.
- i18n réellement généralisée (FR/EN) — aujourd'hui seuls file + ready-check sont traduits.
- Tous les boutons routés (plus de « interaction failed » — corrigé en P0-5, à étendre au vrai report P2-1).

### 6.4 Zéro-admin après le setup (principe directeur)

L'admin n'intervient qu'une fois ; ensuite les joueurs sont **autonomes**. Concrètement :

- **Setup unique** : `/setup` (admin) déploie catégories, salons par mode, messages permanents à boutons, config en base. Après ça, plus aucune commande admin nécessaire pour jouer.
- **Tout au bouton, côté joueur** : Rejoindre/Quitter/Duo (salon de file), Accept/Decline (ready-check), vote de mode, draft/veto (menus), **Report / Contester** (lobby), Spectate. Aucun `/reportwin` à taper : le report se fait au bouton dans le salon du match.
- **Profil self-service** : `/set-profile` (ou un bouton « Configurer mon profil » épinglé dans un salon d'accueil) pour l'IGN et les rôles, sans admin.
- **Découvrabilité** : un salon `#comment-ça-marche` / embed d'accueil avec les boutons d'entrée (choisir ses jeux via `role_menu`, configurer son profil, rejoindre une file). Le joueur ne devrait jamais avoir à connaître une slash-command pour l'usage courant.
- **Commandes admin = exceptions seulement** : `/cancel`, `/sub`, `/suspend`, `/mmr`, `/season`, `/event` — jamais requises pour le flux normal.
- **Garde-fous** : les actions sensibles (report, cancel via bouton) vérifient que l'auteur **participe au match** ; les boutons de file sont ouverts à tous les membres ayant le rôle du jeu.

### 6.5 Présence vocale & anti-AFK (gate voix)

Objectif : garantir que les joueurs sont réellement là (dans un salon vocal du serveur) au lancement, pour tuer les AFK. S'appuie sur l'intent **`GuildVoiceStates`** (déjà activé) et l'event `voiceStateUpdate`.

Mécanisme cible (paramétrable par l'admin au `/setup`, activable/désactivable par jeu ou mode) :

1. **Salon d'attente vocal** : la catégorie du jeu contient un **« 🔊 Waiting Room »**. Recommandé (optionnel) : pour rejoindre la file, il faut être dans le Waiting Room → zéro AFK dès la file.
2. **Ready-check vocal-gated** : au moment d'accepter, si l'option est active, le bot vérifie `interaction.member.voice.channel`. S'il n'est **pas** en vocal → l'accept est refusé avec un message « connecte-toi à un salon vocal pour accepter ». (Évite les gens qui cliquent Accept puis disparaissent.)
3. **Contrôle de présence au lancement** : une fois le ready-check validé et les salons d'équipe créés, le bot **déplace** automatiquement les joueurs présents en vocal vers leur salon d'équipe (perm déjà accordée en P0-3) et laisse **X secondes** (ex. 60 s) pour que les absents rejoignent. Un joueur toujours hors vocal à la fin du délai = **no-show** → match annulé/relancé + pénalité `PenaltyManager` (queue-ban court), les autres remis en file.
4. **Suivi live** : `voiceStateUpdate` met à jour l'embed du lobby (✅ en vocal / ⬜ absent) en temps réel, et peut ping les manquants.

Notes d'implémentation :
- Tout est **opt-in** par serveur/jeu (certaines communautés jouent sans vocal) → flags dans `GameConfig`.
- Réutiliser/assainir `VoiceManager.moveUsersToChannel` (aujourd'hui code mort en partie) comme utilitaire unique.
- Le déplacement automatique échoue silencieusement si le joueur n'est dans aucun vocal → c'est justement ce que le contrôle de présence détecte.

---

## 7. Site web de stats (dans le périmètre)

### 7.1 Architecture recommandée
- **App séparée** (repo ou dossier `web/`), **Next.js** (App Router) — SSR pour le SEO du ladder public + API routes intégrées.
- **Base partagée** : le site lit la **même base** que le bot via **Prisma** (même `schema.prisma`). ⚠️ Cela suppose la migration **SQLite → PostgreSQL** (déjà recommandée en TASKS P1-1, indispensable pour 2 process concurrents bot + web).
- **Auth** : **Discord OAuth2** (« Login with Discord ») → l'utilisateur voit son profil, son historique privé ; le ladder est public.
- **Hébergement** : bot sur Railway (worker), web sur Railway/Vercel, même Postgres managé.

### 7.2 Pages
| Page | Contenu | Accès |
|------|---------|-------|
| `/` | Hero + ladder top global + rush hour en cours | public |
| `/leaderboard/[game]` | Ladder complet paginé, filtres saison/mode | public |
| `/player/[id]` | Profil : Elo par jeu, rangs, winrate, streak, badges, historique | public (privé = détails) |
| `/match/[id]` | Feuille de match : équipes, rôles, carte, Δelo | public |
| `/clan/[name]` | Stats de clan, membres, ladder de clans | public |
| `/me` | Tableau de bord perso (après login Discord) | connecté |

### 7.3 Intégration Discord ↔ Web
- Les embeds Discord (`/stats`, `/profile`, leaderboard) contiennent un **lien** vers la page web correspondante (`.../player/<id>`).
- Le `WebhookManager` (déjà présent) peut pousser les matchs vers le site en temps réel (ou le site lit la base directement).
- Un même `userId` (Discord ID) est la clé partagée entre bot et site → zéro duplication.

### 7.4 Étapes
1. Migrer la base en Postgres (P1-1).
2. Exposer un **package Prisma partagé** (ou dupliquer le schéma) pour le site.
3. Scaffolder Next.js + Discord OAuth.
4. Pages read-only (ladder, profil, match) d'abord ; `/me` ensuite.

---

## 8. Modèle de données — changements Prisma

Résumé des évolutions nécessaires (au-delà du socle actuel) :

- **`GameConfig`** : passer la clé unique à **(guildId, game, mode)** et ajouter un `queueChannelId` par mode. Ajouter `enabledModes` ou une ligne par mode.
- **`Season`** : garantir une seule `isActive: true` ; brancher `Match.seasonId` et `Elo.seasonId` sur la saison active partout (fin du `seasonId: null` codé en dur).
- **`Match`** : ajouter `mode` (soloq/duoq/premade/scrim/1v1/2v2/3v3…), `matchType` (`tvt`/`placement`), `textChannelId`, `voiceChannelIds` (JSON) pour un cleanup fiable même après redémarrage (aujourd'hui contourné en mémoire — voir TASKS P0-4/P1-2). Ajouter `status` (pending/live/reported/cancelled) plutôt que suppression pure.
- **Placement (Arena/TFT)** : ajouter `MatchPlayer.placement` (Int nullable) **ou** une table `MatchPlacement(matchId, teamKey, position)` pour les jeux de type `placement` (classement 1→N). L'Elo se calcule à partir de la position, pas d'un `winner` binaire.
- **Elo par (jeu, mode)** : la clé Elo doit distinguer les formats à Elo séparé (ex. RL 1v1 vs 2v2 vs 3v3, TFT Solo vs Double Up). Étendre la clé `Elo` de `(userId, game, seasonId)` vers `(userId, game, mode, seasonId)` — sinon les 3 files RL partagent le même Elo.
- **`Elo`** : réellement écrire `winStreak` / `highestRating`.
- **Nouvelles tables** :
  - `Team` (premade/scrims) : nom, membres, Elo d'équipe, clan lié.
  - `Event` : type (rush_hour/season), plage horaire/cron, multiplicateur, portée.
  - `Badge` + `UserBadge` : catalogue et attributions.
  - `Dispute` (si report contesté, P2-1).
- **Index** : `Elo(game, seasonId, rating)` pour des ladders rapides.

⚠️ Toute évolution de schéma = **migration Prisma** (`prisma migrate dev --name ...`) + `prisma generate`. Ne pas éditer la base à la main.

---

## 9. Feuille de route intégrée

Le design ci-dessus s'implémente **après** avoir validé le socle. Ordre recommandé :

1. **Valider les P0** (déjà codés) par le test réel sur serveur de test.
2. **P1 (stabilité 24/7)** + **migration Postgres** (P1-1) — pré-requis du site et du multi-mode.
3. **Fondations « version ultime »** :
   - Multi-mode + salons dédiés (§2) + `GameConfig` (guildId, game, mode) (§8).
   - Équilibrage Elo réel + groupes (§4).
   - Saisons actives branchées (§5.2) + `winStreak`/`highestRating`.
4. **Engagement** : rush hours (§5.1), challenges étendus (§5.3), leaderboards live + badges (§5.4).
5. **UX/UI** : bannières complètes, report par boutons (P2-1), report Arena, i18n généralisée (§6).
6. **Site web** : Postgres → Next.js → OAuth → pages (§7).

> Chaque bloc ci-dessus peut devenir un lot de tâches détaillées dans `TASKS.md` (section P2/P3) quand tu décides de l'attaquer, pour rester exécutable par une IA de code.
