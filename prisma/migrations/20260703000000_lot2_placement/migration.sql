-- AlterTable
ALTER TABLE "Match" ADD COLUMN     "matchType" TEXT NOT NULL DEFAULT 'tvt';

-- AlterTable
ALTER TABLE "MatchPlayer" ADD COLUMN     "placement" INTEGER;

