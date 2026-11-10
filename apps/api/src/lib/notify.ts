import { env } from './env'

export interface AlertNotification {
  title: string
  description: string
  severity: string
  url?: string
  triggeredAt?: string
}

function formatMessage(alert: AlertNotification): string {
  const lines = [
    `🚨 *${alert.severity}* — ${alert.title}`,
    '',
    alert.description,
  ]
  if (alert.url) lines.push('', `🔗 ${alert.url}`)
  if (alert.triggeredAt) lines.push(`🕒 ${alert.triggeredAt}`)
  lines.push('', '#MediaIntel #CrisisAlert')
  return lines.join('\n')
}

async function sendTelegram(alert: AlertNotification): Promise<boolean> {
  if (!env.telegramBotToken || !env.telegramChatId) return false
  try {
    const response = await fetch(
      `https://api.telegram.org/bot${env.telegramBotToken}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: env.telegramChatId,
          text: formatMessage(alert),
          parse_mode: 'Markdown',
          disable_web_page_preview: false,
        }),
        signal: AbortSignal.timeout(8_000),
      },
    )
    return response.ok
  } catch (error) {
    console.warn('[notify:telegram]', error instanceof Error ? error.message : error)
    return false
  }
}

async function sendWebhook(alert: AlertNotification): Promise<boolean> {
  if (!env.alertWebhookUrl) return false
  try {
    const response = await fetch(env.alertWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: formatMessage(alert),
        ...alert,
        source: 'media-intel-platform',
      }),
      signal: AbortSignal.timeout(8_000),
    })
    return response.ok
  } catch (error) {
    console.warn('[notify:webhook]', error instanceof Error ? error.message : error)
    return false
  }
}

/** Fan-out to every configured channel; never throws. */
export async function dispatchAlertNotifications(alert: AlertNotification): Promise<void> {
  if (alert.severity !== 'HIGH' && alert.severity !== 'CRITICAL') return
  await Promise.allSettled([sendTelegram(alert), sendWebhook(alert)])
}

export function notificationChannels(): { telegram: boolean; webhook: boolean } {
  return {
    telegram: Boolean(env.telegramBotToken && env.telegramChatId),
    webhook: Boolean(env.alertWebhookUrl),
  }
}
