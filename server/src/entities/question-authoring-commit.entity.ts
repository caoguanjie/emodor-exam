import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import type { AuthoringReceipt } from '../common/question-authoring';

@Entity('question_authoring_commit')
@Index('uk_question_authoring_commit_owner_request', ['ownerId', 'requestId'], { unique: true })
export class QuestionAuthoringCommit {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Column({ name: 'owner_id', type: 'bigint', unsigned: true })
  ownerId: string;

  /** UUIDs are validated and normalized to lowercase at the authoring boundary. */
  @Column({ name: 'request_id', type: 'char', length: 36, charset: 'ascii', collation: 'ascii_bin' })
  requestId: string;

  @Column({ name: 'content_hash', type: 'char', length: 64, charset: 'ascii', collation: 'ascii_bin' })
  contentHash: string;

  /** NULL reserves the unique request only inside an uncommitted transaction. */
  @Column({ name: 'result_json', type: 'json', nullable: true })
  resultJson: AuthoringReceipt | null;

  /** Durable success fact: no automatic expiry that could allow duplicate writes. */
  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 3 })
  createdAt: Date;
}
