import { prisma } from '../utils/db';
import { User } from '@prisma/client';

export type UserStatus = 'IDLE' | 'QUEUED' | 'READY_CHECK' | 'IN_GAME';

export class UserManager {

    /**
     * Atomically sets the user's status.
     * @param userId 
     * @param status 
     */
    static async setStatus(userId: string, status: UserStatus) {
        // Upsert user if strictly needed, but they should exist by the time they interact.
        // We assume they exist or we upsert.
        await prisma.user.upsert({
            where: { id: userId },
            update: { status },
            create: { id: userId, username: 'Unknown', status }
        });
    }

    /**
     * Gets the user's current status.
     * @param userId 
     * @returns UserStatus (default IDLE)
     */
    static async getStatus(userId: string): Promise<UserStatus> {
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { status: true }
        });
        return (user?.status as UserStatus) || 'IDLE';
    }

    /**
     * Checks if a user is IDLE and can join a queue.
     * @param userId 
     * @returns true if IDLE, false otherwise.
     */
    static async isIdle(userId: string): Promise<boolean> {
        const status = await this.getStatus(userId);
        return status === 'IDLE';
    }

    /**
     * Resets a user to IDLE (e.g. on match end).
     * @param userId 
     */
    static async resetStatus(userId: string) {
        await this.setStatus(userId, 'IDLE');
    }
}
