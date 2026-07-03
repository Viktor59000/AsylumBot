import fs from 'fs';
import path from 'path';

const ASSETS_ROOT = path.join(process.cwd(), 'assets');

const GAME_FOLDER_MAP: Record<string, string> = {
    'rl': 'rocket_league',
    'cs2': 'counter_strike_2',
    'r6s': 'rainbow_six_siege',
    'lol': 'league_of_legends',
    'valorant': 'valorant',
    'arena': 'lol_arena',
    'tft': 'teamfight_tactics'
};

export class AssetManager {
    /**
     * Mode-aware banner lookup: `<kind>_<mode>` (e.g. queue_banner_1v1) first,
     * then the game-level `<kind>`, then the global fallback. Returns null if
     * nothing exists — callers keep their placeholder image in that case.
     */
    static getBanner(game: string, mode: string, kind: string): string | null {
        return this.getAssetPath(game, `${kind}_${mode}`) ?? this.getAssetPath(game, kind);
    }

    static getAssetPath(game: string, assetName: string): string | null {
        const gameFolder = GAME_FOLDER_MAP[game];
        if (!gameFolder) return null;

        const gamePath = path.join(ASSETS_ROOT, gameFolder);

        // Priority: GIF > PNG > JPG
        const extensions = ['.gif', '.png', '.jpg'];

        // 1. Check Game Specific Folder
        for (const ext of extensions) {
            const filePath = path.join(gamePath, `${assetName}${ext}`);
            if (fs.existsSync(filePath)) {
                return filePath;
            }
        }

        // 2. Check Global Folder (Fallback)
        const globalPath = path.join(ASSETS_ROOT, 'global');
        for (const ext of extensions) {
            const filePath = path.join(globalPath, `default_${assetName}${ext}`);
            if (fs.existsSync(filePath)) {
                return filePath;
            }
            // Also check without 'default_' prefix in global
            const filePathSimple = path.join(globalPath, `${assetName}${ext}`);
            if (fs.existsSync(filePathSimple)) {
                return filePathSimple;
            }
        }

        return null;
    }
}
