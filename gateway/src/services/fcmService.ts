/**
 * Serviço de disparo Push via Firebase Cloud Messaging (FCM).
 * Suporta:
 *  1. Webhook customizado (PUSH_DISPATCH_WEBHOOK_URL)
 *  2. FCM HTTP v1 com OAuth Bearer Token (FCM_PROJECT_ID + FCM_ACCESS_TOKEN)
 *  3. Modo dev/log quando nenhuma credencial de produção está configurada
 */

export interface PushMessageInput {
  pushToken: string;
  platform: 'android' | 'ios' | 'web';
  accountId: string;
  title: string;
  body: string;
}

export const fcmService = {
  isConfigured(): boolean {
    return Boolean(
      process.env.PUSH_DISPATCH_WEBHOOK_URL ||
        (process.env.FCM_PROJECT_ID && process.env.FCM_ACCESS_TOKEN)
    );
  },

  async sendWakeup(input: PushMessageInput): Promise<{ sent: boolean; mode: string }> {
    const webhookUrl = process.env.PUSH_DISPATCH_WEBHOOK_URL;
    if (webhookUrl) {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (process.env.PUSH_DISPATCH_AUTH_HEADER) {
        headers.Authorization = process.env.PUSH_DISPATCH_AUTH_HEADER;
      }
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          to: input.pushToken,
          platform: input.platform,
          notification: { title: input.title, body: input.body },
          data: {
            type: 'NEW_MAIL_WAKEUP',
            accountId: input.accountId,
            timestamp: new Date().toISOString(),
          },
        }),
      });
      return { sent: res.ok, mode: 'webhook' };
    }

    const projectId = process.env.FCM_PROJECT_ID;
    const accessToken = process.env.FCM_ACCESS_TOKEN;
    if (projectId && accessToken) {
      const fcmUrl = `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`;
      const res = await fetch(fcmUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          message: {
            token: input.pushToken,
            notification: {
              title: input.title,
              body: input.body,
            },
            data: {
              type: 'NEW_MAIL_WAKEUP',
              accountId: input.accountId,
              timestamp: new Date().toISOString(),
            },
            android: {
              priority: 'high',
            },
          },
        }),
      });
      return { sent: res.ok, mode: 'fcm-v1' };
    }

    console.log(
      `[FCM-DEV] Wakeup simulado para ${input.platform} (conta ${input.accountId}). Configure FCM_PROJECT_ID + FCM_ACCESS_TOKEN ou PUSH_DISPATCH_WEBHOOK_URL para entrega real.`
    );
    return { sent: false, mode: 'dev-log' };
  },
};
