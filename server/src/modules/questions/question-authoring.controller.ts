import { Body, Controller, Get, Inject, Param, Post } from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { RoleEnum } from '../../common/errors';
import { Roles } from '../../common/guards/roles.guard';
import { AssembleQuestionsDto, AuthoringCommitDto, AuthoringDtoValidationPipe } from './question-authoring.dto';
import { QuestionAuthoringService } from './question-authoring.service';

@Controller('admin/question-documents')
@Roles(RoleEnum.SUPER_ADMIN, RoleEnum.REGULATION_ADMIN)
export class QuestionAuthoringController {
  constructor(@Inject(QuestionAuthoringService) private readonly authoring: QuestionAuthoringService) {}

  @Post('assemble')
  @Permissions('questions:read')
  assemble(@Body(new AuthoringDtoValidationPipe(['version_ids'])) body: AssembleQuestionsDto, @CurrentUser() user: AuthUser) {
    return this.authoring.assemble(body.version_ids, String(user.id));
  }

  @Post('commit')
  @Permissions('questions:write')
  commit(@Body(new AuthoringDtoValidationPipe(['request_id', 'bundle'])) body: AuthoringCommitDto, @CurrentUser() user: AuthUser) {
    return this.authoring.commit(body, String(user.id));
  }

  @Get('commits/:requestId')
  @Permissions('questions:write')
  getCommit(@Param('requestId') requestId: string, @CurrentUser() user: AuthUser) {
    return this.authoring.getCommit(requestId, String(user.id));
  }
}
