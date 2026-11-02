import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { Member } from './entities/member.entity';
import { MemberProfile } from './entities/member-profile.entity';

@Injectable()
export class MembersRepository {
  constructor(private readonly dataSource: DataSource) {}

  async existsByEmail(email: string): Promise<boolean> {
    const count = await this.dataSource.getRepository(Member).count({ where: { email } });
    return count > 0;
  }

  async insertMember(manager: EntityManager, data: Partial<Member>): Promise<Member> {
    const repo = manager.getRepository(Member);
    return repo.save(repo.create(data));
  }

  async insertProfile(manager: EntityManager, data: Partial<MemberProfile>): Promise<void> {
    await manager.insert(MemberProfile, data);
  }

  async findById(id: number): Promise<Member | null> {
    return this.dataSource.getRepository(Member).findOne({ where: { id } });
  }

  async markWelcomeSent(id: number): Promise<void> {
    await this.dataSource.getRepository(Member).update({ id }, { welcomeSentAt: new Date() });
  }
}
