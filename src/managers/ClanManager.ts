import { prisma } from '../utils/db';
import { EmbedBuilder } from 'discord.js';
import { COLORS } from '../utils/constants';

export class ClanManager {
    async createClan(name: string, leaderId: string, leaderUsername: string, imageUrl?: string) {
        // Check if name exists
        const existing = await prisma.clan.findUnique({ where: { name } });
        if (existing) throw new Error('Clan name already taken.');

        // Check if user is already in a clan
        let user = await prisma.user.findUnique({ where: { id: leaderId } });

        if (!user) {
            user = await prisma.user.create({
                data: {
                    id: leaderId,
                    username: leaderUsername
                }
            });
        }

        if (user.clanId) throw new Error('You are already in a clan.');

        // Create clan and add leader as member
        return await prisma.clan.create({
            data: {
                name,
                leaderId,
                imageUrl,
                members: {
                    connect: { id: leaderId }
                }
            }
        });
    }

    async addMember(clanId: number, userId: string) {
        return await prisma.user.update({
            where: { id: userId },
            data: { clanId }
        });
    }

    async removeMember(userId: string) {
        return await prisma.user.update({
            where: { id: userId },
            data: { clanId: null }
        });
    }

    async updateClan(clanId: number, data: { name?: string, imageUrl?: string }) {
        // If name is being updated, check uniqueness
        if (data.name) {
            const existing = await prisma.clan.findUnique({ where: { name: data.name } });
            if (existing && existing.id !== clanId) throw new Error('Clan name already taken.');
        }

        return await prisma.clan.update({
            where: { id: clanId },
            data
        });
    }

    async getClan(clanId: number) {
        return await prisma.clan.findUnique({
            where: { id: clanId },
            include: { members: { include: { elo: true } } }
        });
    }

    async getClanByName(name: string) {
        return await prisma.clan.findUnique({
            where: { name },
            include: { members: { include: { elo: true } } }
        });
    }

    async getClanStats(clanId: number) {
        const clan = await this.getClan(clanId);
        if (!clan) return null;

        const totalMembers = clan.members.length;
        let totalElo = 0;
        let totalGames = 0;
        let bestPlayer = { username: 'None', elo: 0 };

        for (const member of clan.members) {
            // Sum elo from all games
            const memberTotalElo = member.elo.reduce((acc, curr) => acc + curr.rating, 0);
            totalElo += memberTotalElo;

            const memberTotalGames = member.elo.reduce((acc, curr) => acc + (curr.wins + curr.losses), 0);
            totalGames += memberTotalGames;

            if (memberTotalElo > bestPlayer.elo) {
                bestPlayer = { username: member.username, elo: memberTotalElo };
            }
        }

        return {
            name: clan.name,
            imageUrl: clan.imageUrl,
            leaderId: clan.leaderId,
            totalMembers,
            totalElo,
            totalGames,
            bestPlayer
        };
    }

    async getLeaderboard() {
        const clans = await prisma.clan.findMany({
            include: { members: { include: { elo: true } } }
        });

        const leaderboard = clans.map(clan => {
            const totalElo = clan.members.reduce((sum, member) => {
                return sum + member.elo.reduce((s, e) => s + e.rating, 0);
            }, 0);
            return { name: clan.name, totalElo, memberCount: clan.members.length };
        });

        return leaderboard.sort((a, b) => b.totalElo - a.totalElo);
    }
}
