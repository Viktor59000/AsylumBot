-- AlterTable
ALTER TABLE "GameConfig" ADD COLUMN "queueMessageId" TEXT;

-- AlterTable
ALTER TABLE "UserIgn" ADD COLUMN "preferences" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_GuildConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bannerUrl" TEXT,
    "logoUrl" TEXT,
    "themeColor" TEXT,
    "language" TEXT NOT NULL DEFAULT 'en'
);
INSERT INTO "new_GuildConfig" ("bannerUrl", "id", "logoUrl", "themeColor") SELECT "bannerUrl", "id", "logoUrl", "themeColor" FROM "GuildConfig";
DROP TABLE "GuildConfig";
ALTER TABLE "new_GuildConfig" RENAME TO "GuildConfig";
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "coins" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'IDLE',
    "clanId" INTEGER,
    CONSTRAINT "User_clanId_fkey" FOREIGN KEY ("clanId") REFERENCES "Clan" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_User" ("clanId", "coins", "createdAt", "id", "updatedAt", "username") SELECT "clanId", "coins", "createdAt", "id", "updatedAt", "username" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
