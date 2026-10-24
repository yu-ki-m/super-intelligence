import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { SignupDto } from './dto/signup.dto';
import { MemberResponse, MembersService } from './members.service';

@Controller('members')
export class MembersController {
  constructor(private readonly membersService: MembersService) {}

  /** 会員登録。SignupDto はグローバル ValidationPipe（main.ts）で検証済み。 */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async signup(@Body() dto: SignupDto): Promise<MemberResponse> {
    return this.membersService.signup(dto);
  }
}
