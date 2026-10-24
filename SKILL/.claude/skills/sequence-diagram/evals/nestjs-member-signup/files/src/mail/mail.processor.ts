import { MailerService } from '@nestjs-modules/mailer';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { MembersRepository } from '../members/members.repository';
import { WelcomeJob } from './mail.producer';

/** mail キューのワーカー（API とは別プロセスで動く）。 */
@Processor('mail')
export class MailProcessor extends WorkerHost {
  private readonly logger = new Logger(MailProcessor.name);

  constructor(
    private readonly membersRepository: MembersRepository,
    private readonly mailer: MailerService,
  ) {
    super();
  }

  async process(job: Job<WelcomeJob>): Promise<void> {
    if (job.name !== 'welcome') {
      return;
    }
    const member = await this.membersRepository.findById(job.data.memberId);
    if (!member) {
      this.logger.warn(`member not found: ${job.data.memberId}`);
      return;
    }
    // 送信に失敗すると例外が送出され、BullMQ が attempts の回数まで再試行する
    await this.mailer.sendMail({
      to: job.data.email,
      subject: 'ご登録ありがとうございます',
      template: 'welcome',
      context: { memberId: member.id },
    });
    await this.membersRepository.markWelcomeSent(member.id);
  }
}
