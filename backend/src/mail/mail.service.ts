import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailClient } from '@azure/communication-email';
import { TwoFactorConfig } from '../config/twofa.config';

export interface WelcomeEmailParams {
  /** The username the customer signs in with (their email address). */
  username: string;
  /** One-time temporary password the customer must change on first login. */
  temporaryPassword: string;
  /** Customer company name, used to personalise the greeting. */
  companyName?: string | null;
  /** Absolute URL of the web portal sign-in page. */
  portalUrl: string;
}

/**
 * Thin wrapper around Azure Communication Services email for transactional
 * outbound mail (welcome messages, notifications). Mirrors the ACS delivery
 * pattern used by {@link EmailOtpService}: when no connection string is
 * configured (local dev) the message is logged instead of sent.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private client: EmailClient | null = null;

  constructor(private readonly config: ConfigService) {
    const conn = this.acs.acsConnectionString;
    if (conn) {
      this.client = new EmailClient(conn);
    } else {
      this.logger.warn(
        'ACS_CONNECTION_STRING not set — outbound emails will be logged instead of sent (dev only).',
      );
    }
  }

  // ACS credentials currently live under the `twofa` config namespace; reuse
  // them here so all outbound email shares one verified sender configuration.
  private get acs(): TwoFactorConfig {
    return this.config.get<TwoFactorConfig>('twofa')!;
  }

  /** Sends the portal welcome email containing first-login credentials. */
  async sendWelcome(to: string, params: WelcomeEmailParams): Promise<void> {
    const greeting = params.companyName
      ? `Hello ${params.companyName} team,`
      : 'Hello,';
    const subject = 'Welcome to the SLOMS customer portal';

    const plainText = [
      greeting,
      '',
      'Your SLOMS customer portal account is ready.',
      '',
      `Portal:    ${params.portalUrl}`,
      `Username:  ${params.username}`,
      `Password:  ${params.temporaryPassword}`,
      '',
      'For security you will be asked to set a new password the first time you',
      'sign in. A one-time code will also be emailed to this address to verify',
      'each sign-in.',
      '',
      'If you were not expecting this email, please contact your account manager.',
    ].join('\n');

    const html = `
      <p>${greeting}</p>
      <p>Your SLOMS customer portal account is ready.</p>
      <table cellpadding="4" style="border-collapse:collapse">
        <tr><td><strong>Portal</strong></td><td><a href="${params.portalUrl}">${params.portalUrl}</a></td></tr>
        <tr><td><strong>Username</strong></td><td>${params.username}</td></tr>
        <tr><td><strong>Password</strong></td><td><code>${params.temporaryPassword}</code></td></tr>
      </table>
      <p>For security you will be asked to set a new password the first time you sign in.
      A one-time code will also be emailed to this address to verify each sign-in.</p>
      <p>If you were not expecting this email, please contact your account manager.</p>
    `;

    await this.deliver(to, subject, plainText, html);
  }

  private async deliver(
    to: string,
    subject: string,
    plainText: string,
    html: string,
  ): Promise<void> {
    if (!this.client || !this.acs.acsSenderAddress) {
      // Dev fallback — no ACS configured.
      this.logger.warn(`[DEV] Email to ${to} — ${subject}\n${plainText}`);
      return;
    }

    const poller = await this.client.beginSend({
      senderAddress: this.acs.acsSenderAddress,
      content: { subject, plainText, html },
      recipients: { to: [{ address: to }] },
    });
    await poller.pollUntilDone();
  }
}
