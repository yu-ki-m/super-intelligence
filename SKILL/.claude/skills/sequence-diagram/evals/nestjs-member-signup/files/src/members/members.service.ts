import { ConflictException, Injectable, Logger } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { DataSource } from 'typeorm';
import { MailProducer } from '../mail/mail.producer';
import { SignupDto } from './dto/signup.dto';
import { MembersRepository } from './members.repository';

export interface MemberResponse {
  id: number;
  email: string;
  status: string;
}

@Injectable()
export class MembersService {
  private readonly logger = new Logger(MembersService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly membersRepository: MembersRepository,
    private readonly mailProducer: MailProducer,
  ) {}

  async signup(dto: SignupDto): Promise<MemberResponse> {
    const email = dto.email.trim().toLowerCase();

    const exists = await this.membersRepository.existsByEmail(email);
    if (exists) {
      throw new ConflictException('このメールアドレスは既に登録されています');
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);

    const member = await this.dataSource.transaction(async (manager) => {
      const saved = await this.membersRepository.insertMember(manager, {
        email,
        passwordHash,
        status: 'PENDING',
      });
      await this.membersRepository.insertProfile(manager, {
        memberId: saved.id,
        displayName: dto.displayName,
        birthDate: dto.birthDate ?? null,
      });
      return saved;
    });

    try {
      await this.mailProducer.enqueueWelcome(member.id, email);
    } catch (e) {
      // メール投入に失敗しても会員登録は成功として扱う
      this.logger.warn(`welcome mail enqueue failed: memberId=${member.id}`, e as Error);
    }

    return { id: member.id, email: member.email, status: member.status };
  }
}
