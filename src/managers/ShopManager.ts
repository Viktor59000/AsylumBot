import { prisma } from '../utils/db';
import { Client, Guild } from 'discord.js';


export class ShopManager {
    constructor() { }

    async getItems() {
        return await prisma.shopItem.findMany({
            where: { isActive: true }
        });
    }

    async addItem(name: string, price: number, roleId: string, description?: string) {
        return await prisma.shopItem.create({
            data: {
                name,
                price,
                roleId,
                description
            }
        });
    }

    async buyItem(userId: string, itemId: number, guild: Guild) {
        // 1. Fetch User and Item
        const user = await prisma.user.findUnique({ where: { id: userId } });
        const item = await prisma.shopItem.findUnique({ where: { id: itemId } });

        if (!user) return { success: false, reason: 'User not found.' };
        if (!item) return { success: false, reason: 'Item not found.' };
        if (!item.isActive) return { success: false, reason: 'Item is no longer available.' };

        // 2. Check Funds
        if (user.coins < item.price) {
            return { success: false, reason: `Insufficient coins. You have ${user.coins}, need ${item.price}.` };
        }

        // 3. Check if already owns (optional, but good for roles)
        // We can check if they have the role in Discord, or check purchase history.
        // Let's check Discord role.
        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member) return { success: false, reason: 'Member not found in guild.' };

        if (member.roles.cache.has(item.roleId)) {
            return { success: false, reason: 'You already have this role.' };
        }

        // 4. Process Transaction
        try {
            await prisma.$transaction([
                prisma.user.update({
                    where: { id: userId },
                    data: { coins: { decrement: item.price } }
                }),
                prisma.purchase.create({
                    data: {
                        userId,
                        itemId,
                        cost: item.price
                    }
                })
            ]);

            // 5. Give Role
            const role = guild.roles.cache.get(item.roleId);
            if (role) {
                await member.roles.add(role);
            } else {
                return { success: true, reason: 'Purchased, but role not found in server. Contact admin.' };
            }

            return { success: true, itemName: item.name, remainingCoins: user.coins - item.price };

        } catch (error) {
            console.error('Purchase failed:', error);
            return { success: false, reason: 'Transaction failed.' };
        }
    }
}
