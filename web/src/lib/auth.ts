import type { NextAuthOptions } from 'next-auth';
import DiscordProvider from 'next-auth/providers/discord';

// Discord OAuth2 — the Discord user id is THE shared key between bot and web.
export const authOptions: NextAuthOptions = {
    providers: [
        DiscordProvider({
            clientId: process.env.DISCORD_CLIENT_ID ?? '',
            clientSecret: process.env.DISCORD_CLIENT_SECRET ?? '',
            authorization: { params: { scope: 'identify' } },
        }),
    ],
    session: { strategy: 'jwt' },
    callbacks: {
        async jwt({ token, profile }) {
            if (profile && 'id' in profile) {
                token.discordId = (profile as { id: string }).id;
            }
            return token;
        },
        async session({ session, token }) {
            (session as { discordId?: string }).discordId = token.discordId as string | undefined;
            return session;
        },
    },
};

export interface SessionWithDiscord {
    discordId?: string;
    user?: { name?: string | null; image?: string | null };
}
