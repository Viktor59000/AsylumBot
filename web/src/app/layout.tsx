import type { Metadata } from 'next';
import Link from 'next/link';
import { getServerSession } from 'next-auth';
import { authOptions, SessionWithDiscord } from '@/lib/auth';
import './globals.css';

export const metadata: Metadata = {
    title: 'ASYLUM ELO HUB',
    description: 'Competitive inhouse ladders — matchmaking, Elo, seasons.',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
    const session = (await getServerSession(authOptions)) as SessionWithDiscord | null;

    return (
        <html lang="en">
            <body>
                <nav className="nav">
                    <div className="container nav-inner">
                        <Link href="/" className="brand">
                            ASYLUM <span>ELO HUB</span>
                        </Link>
                        <div className="nav-links">
                            <Link href="/leaderboard/rl">Leaderboards</Link>
                            <Link href="/me">My profile</Link>
                        </div>
                        <div className="nav-right">
                            {session?.discordId ? (
                                <>
                                    <Link className="pill pill-gold" href={`/player/${session.discordId}`}>
                                        {session.user?.name ?? 'Profile'}
                                    </Link>
                                    <a className="btn" href="/api/auth/signout">Sign out</a>
                                </>
                            ) : (
                                <a className="btn btn-gold" href="/api/auth/signin">Sign in with Discord</a>
                            )}
                        </div>
                    </div>
                </nav>
                <main className="container">{children}</main>
                <footer className="footer">
                    <div className="container">ASYLUM ELO HUB — powered by AsylumBot. Stats update live from the shared database.</div>
                </footer>
            </body>
        </html>
    );
}
