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

        // Party
        party_no_1v1: '❌ Parties are not available in 1v1 queues.',
        party_not_for_you: '❌ This invite is not for you.',
        party_inviter_gone: '❌ The inviter is no longer in the queue.',
        party_joined: '✅ {user} joined {inviter}\'s party!',
        party_declined: '❌ Invite declined.',
        party_must_be_in_queue: '❌ You must be in the queue to invite others.',
        party_select_player: 'Select a player to invite to your party:',
        party_invited: '{target}, you have been invited to join {inviter}\'s party for **{game}**!',
        party_no_self: '❌ You cannot invite yourself.',
        party_no_bots: '❌ You cannot invite bots.',
        party_full: '❌ This party is full ({max} players max for this mode).',

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

        // Party
        party_no_1v1: '❌ Les groupes ne sont pas disponibles en file 1v1.',
        party_not_for_you: '❌ Cette invitation ne vous est pas destinée.',
        party_inviter_gone: '❌ L\'invitant n\'est plus dans la file.',
        party_joined: '✅ {user} a rejoint le groupe de {inviter} !',
        party_declined: '❌ Invitation refusée.',
        party_must_be_in_queue: '❌ Vous devez être dans la file pour inviter quelqu\'un.',
        party_select_player: 'Sélectionnez un joueur à inviter dans votre groupe :',
        party_invited: '{target}, vous êtes invité à rejoindre le groupe de {inviter} pour **{game}** !',
        party_no_self: '❌ Vous ne pouvez pas vous inviter vous-même.',
        party_no_bots: '❌ Vous ne pouvez pas inviter de bots.',
        party_full: '❌ Ce groupe est complet ({max} joueurs max pour ce mode).',

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
