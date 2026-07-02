import { prisma } from './db';

export type Language = 'en' | 'fr';

const translations = {
    en: {
        // Ready Check
        ready_check_title: '⚠️ MATCH FOUND! ACCEPT NOW!',
        ready_check_desc: 'You have **60 seconds** to accept the match.',
        ready_check_time: 'Time Remaining:',
        ready_check_accepted: 'Accepted',
        ready_check_declined: 'Declined',
        ready_check_waiting: 'Waiting',
        ready_check_cancelled: '❌ **Match Cancelled!** {count} player(s) failed to accept.',
        ready_check_success: '✅ **All Players Accepted!** Proceeding to Vote Phase...',
        ready_check_accept_btn: 'ACCEPT',
        ready_check_decline_btn: 'DECLINE',

        // Queue
        queue_joined: '✅ You joined the queue for **{game}**.',
        queue_left: '✅ You left the queue for **{game}**.',
        queue_already_in: '❌ You are already in the queue.',
        queue_full: '🔔 **Queue Full!**',
        queue_match_found: '✅ **Match Found!** You have been removed from all other queues.',

        // General
        error_generic: '❌ An error occurred.',
        error_no_permission: '❌ You do not have permission to use this command.',
    },
    fr: {
        // Ready Check
        ready_check_title: '⚠️ MATCH TROUVÉ ! ACCEPTEZ MAINTENANT !',
        ready_check_desc: 'Vous avez **60 secondes** pour accepter le match.',
        ready_check_time: 'Temps Restant :',
        ready_check_accepted: 'Accepté',
        ready_check_declined: 'Refusé',
        ready_check_waiting: 'En attente',
        ready_check_cancelled: '❌ **Match Annulé !** {count} joueur(s) n\'ont pas accepté.',
        ready_check_success: '✅ **Tous les joueurs ont accepté !** Passage à la phase de vote...',
        ready_check_accept_btn: 'ACCEPTER',
        ready_check_decline_btn: 'REFUSER',

        // Queue
        queue_joined: '✅ Vous avez rejoint la file pour **{game}**.',
        queue_left: '✅ Vous avez quitté la file pour **{game}**.',
        queue_already_in: '❌ Vous êtes déjà dans la file.',
        queue_full: '🔔 **File Pleine !**',
        queue_match_found: '✅ **Match Trouvé !** Vous avez été retiré des autres files.',

        // General
        error_generic: '❌ Une erreur est survenue.',
        error_no_permission: '❌ Vous n\'avez pas la permission d\'utiliser cette commande.',
    }
};

export type TranslationKey = keyof typeof translations.en;

// Simple cache for guild languages
const guildLanguages = new Map<string, Language>();

export async function getGuildLanguage(guildId: string): Promise<Language> {
    if (guildLanguages.has(guildId)) {
        return guildLanguages.get(guildId)!;
    }

    const config = await prisma.guildConfig.findUnique({
        where: { id: guildId }
    });

    const lang = (config?.language as Language) || 'en';
    guildLanguages.set(guildId, lang);
    return lang;
}

export function setGuildLanguageCache(guildId: string, lang: Language) {
    guildLanguages.set(guildId, lang);
}

export function t(key: TranslationKey, lang: Language, args?: Record<string, string | number>): string {
    const dict = translations[lang] || translations.en;
    let text = dict[key] || translations.en[key] || key;

    if (args) {
        Object.entries(args).forEach(([k, v]) => {
            text = text.replace(`{${k}}`, String(v));
        });
    }

    return text;
}
