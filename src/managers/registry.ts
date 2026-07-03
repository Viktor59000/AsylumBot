import { Client } from 'discord.js';
import { Matchmaker } from './Matchmaker';
import { ChallengeManager } from './ChallengeManager';
import { DecayManager } from './DecayManager';
import { LeaderboardManager } from './LeaderboardManager';
import { PenaltyManager } from './PenaltyManager';
import { WebhookManager } from './WebhookManager';
import { RoleMenuManager } from './RoleMenuManager';
import { QueueMessageUpdater } from './QueueMessageUpdater';
import { ReportManager } from './ReportManager';
import { afkManager } from './AFKManager';
import { logger } from '../utils/logger';

export interface Managers {
    matchmaker: Matchmaker;
    challenge: ChallengeManager;
    decay: DecayManager;
    leaderboard: LeaderboardManager;
    penalty: PenaltyManager;
    webhook: WebhookManager;
    roleMenu: RoleMenuManager;
    queueMessageUpdater: QueueMessageUpdater;
    report: ReportManager;
}

let managers: Managers | null = null;

/**
 * Singleton registry (P1-3): every manager is instantiated exactly once at
 * `ready`. NEVER `new XxxManager()` in a command/interaction handler — the
 * timer-owning managers (Challenge/Decay) leak intervals otherwise.
 */
export function initManagers(client: Client): Managers {
    if (managers) return managers;

    managers = {
        matchmaker: new Matchmaker(client),
        challenge: new ChallengeManager(client),
        decay: new DecayManager(client),
        leaderboard: new LeaderboardManager(client),
        penalty: new PenaltyManager(client),
        webhook: new WebhookManager(),
        roleMenu: new RoleMenuManager(),
        queueMessageUpdater: new QueueMessageUpdater(client),
        report: new ReportManager(client),
    };

    managers.challenge.start();
    managers.decay.start();

    logger.info('[registry] Managers initialized.');
    return managers;
}

export function getManagers(): Managers {
    if (!managers) throw new Error('Managers not initialized yet (initManagers must run at ready).');
    return managers;
}

/** Cancels every manager-owned timer (graceful shutdown, P1-4). */
export function destroyManagers() {
    if (!managers) return;
    managers.challenge.destroy();
    managers.decay.destroy();
    managers.queueMessageUpdater.destroy();
    afkManager.stopMonitoring();
    managers = null;
}
