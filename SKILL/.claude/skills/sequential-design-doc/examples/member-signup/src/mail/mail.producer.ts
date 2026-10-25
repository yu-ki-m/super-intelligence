import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';

export interface WelcomeJob {
  memberId: number;
  email: string;
}

@Injectable()
export class MailProducer {
  constructor(@InjectQueue('mail') private readonly mailQueue: Queue<WelcomeJob>) {}

  async enqueueWelcome(memberId: number, email: string): Promise<void> {
    await this.mailQueue.add(
      'welcome',
      { memberId, email },
      { attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
    );
  }
}
