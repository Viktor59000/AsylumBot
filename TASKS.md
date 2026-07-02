# TASKS — AsylumBot (checklist d'implémentation)

Dérivé de `AUDIT_ASYLUMBOT.md`. Chaque tâche est autonome et formulée comme un prompt actionnable pour une IA de code (Claude Code / Codex). Cocher `[x]` une fois terminé + testé.
Convention : **P0** = débloque le bot · **P1** = stabilité 24/7 · **P2** = complétude · **P3** = polish.

---

## P0 — Le bot doit pouvoir faire UN cycle de match complet

- [ ] **P0-7 — PrismaClient unique.** Remplacer chaque `new PrismaClient()` par `import { prisma } from '<chemin>/utils/db'`. Fichiers : `managers/EloManager.ts`, `managers/ShopManager.ts`, `managers/RoleMenuManager.ts`, `commands/match/report.ts`, `commands/admin/season.ts`, `commands/admin/sub.ts`, `commands/admin/cancel.ts`, `commands/admin/mmr.ts`, `commands/leaderboard.ts`, `commands/player/ign.ts`. Vérif : `grep -rn "new PrismaClient" src` ne retourne plus rien (hors `utils/db.ts`).

- [ ] **P0-1 — `channelId` de file renseigné.** Ajouter `QueueManager.setChannel(game, channelId)`. Au `ready` dans `index.ts`, charger tous les `GameConfig` et appeler `setChannel` pour chaque `queueChannelId`. À la fin de `/setup` (après l'`upsert`), appeler `setChannel`. Log d'alerte si un jeu configuré n'a pas de channel. Test : file pleine → `queueFull` trouve le salon → ready-check démarre.

- [ ] **P0-6 — `guildId` propagé.** Ajouter `guildId` à `LobbyState`, le remplir dans `LobbyManager.createLobby`. Dans `Matchmaker.finalizeMatch`, récupérer le guild via `client.guilds.cache.get(lobby.guildId)` au lieu de `.get(lobby.players[0].user.id)`. Supprimer le repli `.first()`.

- [ ] **P0-2 — Reset des statuts à `IDLE` en fin de cycle.** Après report validé (`report.ts`), après annulation (`cancel.ts`) : `UserManager.resetStatus(userId)` pour tous les participants. Dans `sub.ts` : ancien joueur → `IDLE`, nouveau → `IN_GAME`. Centraliser via `endMatchCleanup` (P0-4).

- [ ] **P0-4 — Nettoyage complet des salons.** Persister tous les ids de salons du match (texte + tous vocaux). Ajouter à `Match` : `textChannelId String?` et `voiceChannelIds String?` (JSON), migration Prisma. `finalizeMatch` les remplit. Créer `cleanupMatch(matchId, guild)` : supprime tous les salons, retire le lobby mémoire, reset des statuts IDLE. Appelée par report ET cancel. Vérif : plus aucun salon `lobby-*` orphelin après un match.

- [ ] **P0-3 — Permissions vocales par équipe.** Après `finalizeMatch` (équipes connues), pour chaque salon d'équipe : `permissionOverwrites.edit(userId, { ViewChannel:true, Connect:true, Speak:true })` pour les membres concernés (team1 → vocal 1, team2 → vocal 2 ; arena → déjà géré). Supprimer `VoiceManager` (doublon) ou en faire l'unique utilitaire. Test : un joueur LoL/CS2/Valo/R6 peut rejoindre son salon.

- [ ] **P0-8 — Draft générique.** Dans `DraftManager.startDraft`, générer `pickOrder` en snake draft dynamique à partir de `players.length - 2` (capitaines) ; terminer dès pool vide ; gérer effectif impair. Test : draft OK en 5v5 ET en Rocket League (6 joueurs).

- [ ] **P0-5 — Boutons morts routés ou retirés.** `match_report_win`, `match_cancel`, `rl_checkin`, `refresh_leaderboard_<game>` : ajouter les branches dans `index.ts` (report → P2-1, refresh → `LeaderboardManager.updateLeaderboard`, checkin → ack). À défaut d'implémentation, retirer les boutons. Aucun bouton ne doit produire "interaction failed".

## P1 — Stabilité & résilience 24/7

- [ ] **P1-1 — Persistance DB Railway.** Monter un volume persistant + `DATABASE_URL` dessus, OU migrer vers PostgreSQL (`provider = "postgresql"`, régénérer migrations). Documenter.
- [ ] **P1-2 — Recovery au boot.** Au `ready` : reset IDLE des `QUEUED`/`READY_CHECK` ; marquer/annuler les `Match winner:null` anciens + nettoyer leurs salons ; supprimer les `lobby-*` orphelins. (Décision : ne pas persister l'état live en v1, nettoyer proprement.)
- [ ] **P1-3 — Managers singletons.** Instancier tous les managers une fois au `ready` ; supprimer les `new ChallengeManager/PenaltyManager/LeaderboardManager/WebhookManager` dans `report.ts` et ailleurs. Corrige la fuite de timers.
- [ ] **P1-4 — Handlers globaux + arrêt gracieux.** `unhandledRejection`, `uncaughtException`, `client.on('error'|'shardError')`, `SIGINT/SIGTERM` → `prisma.$disconnect()` + `client.destroy()`. Logger structuré.
- [ ] **P1-5 — Timers annulables.** Stocker et `clearTimeout` votes/ready-checks avant relance. Remplacer le reset challenges par un cron idempotent (UTC).
- [ ] **P1-6 — `await` sur les mutations de statut.** `QueueManager`, `ReadyCheckManager`, `AFKManager`, `queue.ts`.
- [ ] **P1-7 — Retirer intent `MessageContent`** (inutilisé) + clarifier enregistrement global vs guild-only.
- [ ] **P1-8 — Auto-update du message de file permanent** via event `queueUpdate` + `queueMessageId` (throttle ~2 s).
- [ ] **P1-9 — `.env.example` + README à jour** (noms de commandes réels, vars requises, Tracker.gg absent).

## P2 — Fonctionnalités manquantes

- [ ] **P2-1 — Report vérifié par boutons** (confirmation croisée ou capitaine/admin + fenêtre de contestation, écriture dans `match-history` + logs admin, blocage des non-participants).
- [ ] **P2-2 — Équilibrage réel par Elo** (+ respect des groupes/duos, + rôles LoL/Valo en v2) dans `Matchmaker.balanceTeams`.
- [ ] **P2-3 — `/history [membre] [jeu]`** paginé (exploite `Match`/`MatchPlayer`).
- [ ] **P2-4 — Pénalités no-show/dodge** automatiques (queue-ban croissant) sur refus/expiration ready-check.
- [ ] **P2-5 — Saisons complètes** (`/season start`, saison active liée aux Elo/matchs, filtrage stats/leaderboard/decay).
- [ ] **P2-6 — `winStreak`/`highestRating`** mis à jour dans `EloManager.updateElo` (+ MVP optionnel).
- [ ] **P2-7 — Veto : timer + choix de side + capitaine désigné.**
- [ ] **P2-8 — Homogénéité jeux** : vraie `ValorantStrategy`, report Arena défini, pools de cartes cohérents.
- [ ] **P2-9 — Logs admin effectifs** dans `adminLogChannelId` (force-start, suspend, mmr, cancel, sub, disputes).
- [ ] **P2-10 — DraftLoL réel** ou message manuel honnête.

## P3 — Polish

- [ ] **P3-1** Fusion `/ign` + `/set-profile`, chaînage des préférences.
- [ ] **P3-2** Leaderboard en message permanent édité (`leaderboardMessageId`).
- [ ] **P3-3** Embed match "in-progress" vivant.
- [ ] **P3-4** Transfert/suppression de clan, dissolution auto.
- [ ] **P3-5** Anti-smurf (vérif Riot ID, calibration, multi-comptes).
- [ ] **P3-6** Tests (runner réel) ; supprimer `scripts/test_db.ts`.
- [ ] **P3-7** Logger structuré, remplacement `console.log`.
- [ ] **P3-8** Nettoyer code mort (`VoiceManager`, `createMatchEmbed`, commentaires d'auto-dialogue).
- [ ] **P3-9** i18n réellement généralisée.
- [ ] **P3-10** CI (lint+build) ; `onDelete: Cascade` sur `MatchPlayer`/`Elo`.

---

### Ordre recommandé
1. Sprint 0 : P0-7, P1-9, P1-1.
2. Sprint 1 (« un match qui marche ») : P0-1, P0-6, P0-2, P0-4, P0-3, P0-8, P0-5.
3. Sprint 2 (« 24/7 ») : P1-2, P1-3, P1-4, P1-5, P1-6, P1-8, P1-7.
4. Sprint 3+ (« version ultime ») : P2 puis P3.

### Test d'acceptation (fin Sprint 1)
10 comptes → file LoL → ready-check → vote Balanced → salons créés avec accès vocal → report → Elo mis à jour → salons supprimés → les 10 peuvent re-queue. Répéter en Rocket League (6 joueurs) et en mode Captains.
