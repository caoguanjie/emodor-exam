import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('course_lesson')
@Index('idx_course_lesson_course', ['courseId'])
@Index('idx_course_lesson_chapter_sort', ['chapterId', 'sortOrder'])
export class CourseLesson {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Column({ name: 'course_id', type: 'bigint', unsigned: true })
  courseId: string;

  @Column({ name: 'chapter_id', type: 'bigint', unsigned: true })
  chapterId: string;

  @Column({ type: 'varchar', length: 255 })
  title: string;

  @Column({ name: 'lesson_type', type: 'varchar', length: 32, default: 'video' })
  lessonType: 'video';

  @Column({ name: 'is_required', type: 'tinyint', unsigned: true, default: 1 })
  required: number;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  @Column({ name: 'current_version_id', type: 'bigint', unsigned: true, nullable: true })
  currentVersionId: string | null;

  @CreateDateColumn({ name: 'created_at', precision: 3 })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', precision: 3 })
  updatedAt: Date;
}
