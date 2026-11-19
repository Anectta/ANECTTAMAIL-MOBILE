import { ImapIdleService } from './imapIdleService';
import type { MailServerConfig } from './mailService';
import { fcmService } from './fcmService';

export interface PushRegistrationRequest {
  deviceId: string;
  platform: 'android' | 'ios' | 'web';
  pushToken: string;
  accountId: string;
  imapConfig: MailServerConfig;
}

interface PushSubscription {
  deviceId: string;
  platform: 'android' | 'ios' | 'web';
  pushToken: string;
  accountId: string;
  accountKey: string;
  registeredAt: number;
}

const subscriptions = new Map<string, PushSubscription>();
let listenerInitialized = false;

function subKey(deviceId: string, accountId: string): string {
  return `${deviceId}::${accountId}`;
}

function accountKeyOf(config: MailServerConfig): string {
  return `${config.user}@${config.host}:${config.port || 993}`;
}

function ensureIdleListener(): void {
  if (listenerInitialized) return;
  listenerInitialized = true;
  ImapIdleService.setListener((triggeredAccountKey: string) => {
    for (const sub of subscriptions.values()) {
      if (sub.accountKey === triggeredAccountKey) {
        void fcmService.sendWakeup({
          pushToken: sub.pushToken,
          platform: sub.platform,
          accountId: sub.accountId,
          title: 'Anectta MAIL',
          body: 'Você recebeu uma nova mensagem.',
        });
      }
    }
  });
}

export const pushRelayService = {
  register(req: PushRegistrationRequest): { ok: boolean; activeSubscriptions: number } {
    ensureIdleListener();

    const accountKey = accountKeyOf(req.imapConfig);
    const key = subKey(req.deviceId, req.accountId);

    subscriptions.set(key, {
      deviceId: req.deviceId,
      platform: req.platform,
      pushToken: req.pushToken,
      accountId: req.accountId,
      accountKey,
      registeredAt: Date.now(),
    });

    ImapIdleService.start(req.imapConfig);

    return { ok: true, activeSubscriptions: subscriptions.size };
  },

  unregister(deviceId: string, accountId?: string): { ok: boolean; removed: number } {
    let removed = 0;
    for (const [key, entry] of subscriptions.entries()) {
      if (entry.deviceId === deviceId && (!accountId || entry.accountId === accountId)) {
        subscriptions.delete(key);
        removed++;
      }
    }
    return { ok: true, removed };
  },

  getStats(): { activeSubscriptions: number; fcmConfigured: boolean } {
    return {
      activeSubscriptions: subscriptions.size,
      fcmConfigured: fcmService.isConfigured(),
    };
  },
};
