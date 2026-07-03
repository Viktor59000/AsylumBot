import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions, SessionWithDiscord } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function MePage() {
    const session = (await getServerSession(authOptions)) as SessionWithDiscord | null;

    if (session?.discordId) {
        redirect(`/player/${session.discordId}`);
    }

    return (
        <section className="hero">
            <h1>Your <em>ASYLUM</em> dashboard.</h1>
            <p>
                Sign in with the same Discord account you use on the server — your ladders,
                badges and match history are linked through your Discord ID.
            </p>
            <div className="hero-actions">
                <a className="btn btn-gold" href="/api/auth/signin">Sign in with Discord</a>
            </div>
        </section>
    );
}
