import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('regulation_scope')
export class RegulationScope {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'regulation_id', type: 'bigint' })
  regulationId: string;

  /** 被圈定部门；is_all=1 时为 NULL */
  @Column({ name: 'department_id', type: 'bigint', nullable: true })
  departmentId: string | null;

  /** 1=面向全员，0=按部门圈定；is_all=1 时仅此一行（应用层不变式，03 册 3.2.3） */
  @Column({ name: 'is_all', type: 'tinyint', width: 1, default: 0 })
  isAll: number;
}
