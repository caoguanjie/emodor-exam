import { ArgumentMetadata, BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate, ValidationError } from 'class-validator';

/**
 * DTO 校验管道：class-validator 白名单校验（03 册 1.7、07 册 4.4.1）。
 * 失败时输出 { fields: { 字段: 原因[] } }，由全局异常过滤器映射为 40001。
 */
@Injectable()
export class DtoValidationPipe implements PipeTransform {
  async transform(value: any, { metatype }: ArgumentMetadata) {
    if (!metatype || metatype === String || metatype === Number || metatype === Boolean || metatype === Object) {
      return value;
    }
    const dto = plainToInstance(metatype, value, { exposeDefaultValues: true });
    if (typeof dto !== 'object' || dto === null) return value;
    const errors: ValidationError[] = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: false,
      skipMissingProperties: false,
    });
    if (errors.length === 0) return dto;
    const fields: Record<string, string[]> = {};
    const walk = (errs: ValidationError[], prefix = '') => {
      for (const e of errs) {
        const key = prefix ? `${prefix}.${e.property}` : e.property;
        if (e.constraints) fields[key] = Object.values(e.constraints);
        if (e.children?.length) walk(e.children, key);
      }
    };
    walk(errors);
    throw new BadRequestException({ fields });
  }
}
