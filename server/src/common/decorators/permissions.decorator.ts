import { SetMetadata } from '@nestjs/common';
import { PermissionCode } from '../../modules/access/permission-catalog';

export const PERMISSIONS_KEY = 'permissions';
export const Permissions = (...permissions: PermissionCode[]): MethodDecorator & ClassDecorator => SetMetadata(PERMISSIONS_KEY, permissions);
