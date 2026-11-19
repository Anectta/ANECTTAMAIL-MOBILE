import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import type { MobileAccountConfig } from './secureStorage';
import { secureStorage } from './secureStorage';
import { mailGatewayClient } from './mailGatewayClient';

let registeredToken: string | null = null;

/**
 * Inicializa Push Notifications nativas (Android FCM / iOS APNs) quando rodando no dispositivo.
 * No navegador web, encerra silenciosamente sem erro.
 */
export async function initNativePush(
  onNewMailWakeup: () => void
): Promise<string | null> {
  if (!Capacitor.isNativePlatform()) {
    return null;
  }

  try {
    let perm = await PushNotifications.checkPermissions();
    if (perm.receive === 'prompt') {
      perm = await PushNotifications.requestPermissions();
    }
    if (perm.receive !== 'granted') {
      return null;
    }

    await PushNotifications.register();

    return await new Promise<string | null>((resolve) => {
      let settled = false;
      const done = (token: string | null) => {
        if (!settled) {
          settled = true;
          resolve(token);
        }
      };

      void PushNotifications.addListener('registration', (token) => {
        registeredToken = token.value;
        done(token.value);
      });

      void PushNotifications.addListener('registrationError', () => {
        done(null);
      });

      void PushNotifications.addListener('pushNotificationReceived', () => {
        onNewMailWakeup();
      });

      void PushNotifications.addListener('pushNotificationActionPerformed', () => {
        onNewMailWakeup();
      });

      setTimeout(() => done(registeredToken), 5000);
    });
  } catch {
    return null;
  }
}

export async function bindAccountToPushRelay(account: MobileAccountConfig): Promise<void> {
  if (!registeredToken || !account.imapHost || !account.email || !account.password) return;
  const deviceId = await secureStorage.getOrCreateDeviceId();
  const platform = Capacitor.getPlatform() === 'ios' ? 'ios' : 'android';
  await mailGatewayClient.registerPush(account, {
    deviceId,
    platform,
    pushToken: registeredToken,
  });
}
