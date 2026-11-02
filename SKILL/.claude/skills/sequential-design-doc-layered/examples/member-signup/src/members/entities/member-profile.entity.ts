import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity({ name: 'member_profiles' })
export class MemberProfile {
  @PrimaryColumn({ name: 'member_id' })
  memberId!: number;

  @Column({ name: 'display_name' })
  displayName!: string;

  @Column({ name: 'birth_date', type: 'date', nullable: true })
  birthDate!: string | null;
}
