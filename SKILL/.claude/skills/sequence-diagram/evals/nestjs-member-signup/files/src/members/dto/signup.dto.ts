import { IsDateString, IsEmail, IsOptional, IsString, Length, Matches } from 'class-validator';

export class SignupDto {
  @IsEmail()
  email!: string;

  /** 8〜64文字、英字と数字を各1文字以上含む */
  @IsString()
  @Length(8, 64)
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/)
  password!: string;

  @IsString()
  @Length(1, 30)
  displayName!: string;

  @IsOptional()
  @IsDateString()
  birthDate?: string;
}
