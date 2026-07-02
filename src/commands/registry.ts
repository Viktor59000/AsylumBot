import { command as adminCancel } from './admin/cancel';
import { command as adminConfig } from './admin/config';
import { command as adminKick } from './admin/kick';
import { command as adminLanguage } from './admin/language';
import { command as adminMmr } from './admin/mmr';
import { command as adminRoleMenu } from './admin/role_menu';
import { command as adminSeason } from './admin/season';
import { command as adminSetup } from './admin/setup';
import { command as adminSub } from './admin/sub';
import { command as adminSuspend } from './admin/suspend';
import { command as adminWebhook } from './admin/webhook';
import { command as clanClan } from './clan/clan';
import { command as generalHelp } from './general/help';
import { command as leaderboard } from './leaderboard';
import { command as matchReport } from './match/report';
import { command as matchReportPlacement } from './match/reportplacement';
import { command as playerChallenges } from './player/challenges';
import { command as playerIgn } from './player/ign';
import { command as playerSetProfile } from './player/setProfile';
import { command as playerStats } from './player/stats';
import { command as profile } from './profile';
import { command as queueQueue } from './queue/queue';
import { command as shopShop } from './shop/shop';

export const allCommands = [
    adminCancel,
    adminConfig,
    adminKick,
    adminLanguage,
    adminMmr,
    adminRoleMenu,
    adminSeason,
    adminSetup,
    adminSub,
    adminSuspend,
    adminWebhook,
    clanClan,
    generalHelp,
    leaderboard,
    matchReport,
    matchReportPlacement,
    playerChallenges,
    playerIgn,
    playerSetProfile,
    playerStats,
    profile,
    queueQueue,
    shopShop
];
