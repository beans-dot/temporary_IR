import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type ExportFormat = 'xlsx' | 'png' | 'pdf' | 'json' | 'md';

@Entity('ir_export_log')
export class IrExportLog {
  @PrimaryGeneratedColumn({ name: 'export_id' })
  exportId: number;

  @Column({ name: 'user_id', type: 'varchar', length: 50 })
  userId: string;

  @Column({ name: 'user_name', type: 'varchar', length: 100 })
  userName: string;

  @Column({ name: 'format', type: 'varchar', length: 20 })
  format: ExportFormat;

  @Column({ name: 'source', type: 'varchar', length: 100 })
  source: string;

  @Column({ name: 'filename', type: 'varchar', length: 300 })
  filename: string;

  @Column({ name: 'summary', type: 'text', nullable: true })
  summary: string | null;

  @Column({ name: 'ip', type: 'varchar', length: 100, nullable: true })
  ip: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
