import { SetMetadata } from '@nestjs/common';
import { PermissionCode } from '../../modules/access/permission-catalog';

export const PERMISSIONS_KEY = 'permissions';
export const Permissions = (...permissions: PermissionCode[]): MethodDecorator & ClassDecorator => SetMetadata(PERMISSIONS_KEY, permissions);
export const PERMISSIONS_ANY_KEY = 'permissions_any';
/** At least one listed permission is required; Permissions keeps its AND semantics. */
export const PermissionsAny = (...permissions: PermissionCode[]): MethodDecorator & ClassDecorator => SetMetadata(PERMISSIONS_ANY_KEY, permissions);
