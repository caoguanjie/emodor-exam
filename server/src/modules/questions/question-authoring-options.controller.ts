import { Controller, Get } from '@nestjs/common';
import { PermissionsAny } from '../../common/decorators/permissions.decorator';
import { RoleEnum } from '../../common/errors';
import { Roles } from '../../common/guards/roles.guard';
import { difficultyCatalog } from '../../common/question-difficulty';

@Controller('admin/questions')
@Roles(RoleEnum.SUPER_ADMIN, RoleEnum.REGULATION_ADMIN)
export class QuestionAuthoringOptionsController {
  @Get('authoring-options')
  @PermissionsAny('questions:read', 'questions:write')
  options() { return { difficulties: difficultyCatalog() }; }
}
