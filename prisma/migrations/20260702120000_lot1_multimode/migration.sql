-- DropIndex
DROP INDEX "Elo_userId_game_seasonId_key";

-- DropIndex
DROP INDEX "GameConfig_guildId_game_key";

-- AlterTable
ALTER TABLE "Elo" ADD COLUMN     "mode" TEXT NOT NULL DEFAULT 'soloq';

-- AlterTable
ALTER TABLE "Match" ADD COLUMN     "mode" TEXT NOT NULL DEFAULT 'soloq';

-- AlterTable
ALTER TABLE "GameConfig" ADD COLUMN     "leaderboardMessageId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Elo_userId_game_mode_seasonId_key" ON "Elo"("userId", "game", "mode", "seasonId");

-- CreateIndex
CREATE UNIQUE INDEX "GameConfig_guildId_game_mode_key" ON "GameConfig"("guildId", "game", "mode");

