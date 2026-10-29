import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { Repository } from 'typeorm';
import {
  IrExportLog,
  type ExportFormat,
} from '../../entities/ir-export-log.entity';
import { IrLoginLog } from '../../entities/ir-login-log.entity';
import { IrUser, type UserStatus } from '../../entities/ir-user.entity';
import { MailService } from '../mail/mail.service';

export type ActivityKind = 'all' | 'login' | 'export';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(IrUser)
    private readonly usersRepo: Repository<IrUser>,
    @InjectRepository(IrLoginLog)
    private readonly loginLogRepo: Repository<IrLoginLog>,
    @InjectRepository(IrExportLog)
    private readonly exportLogRepo: Repository<IrExportLog>,
    private readonly mailService: MailService,
  ) {}

  private toPublic(user: IrUser) {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      affiliationType: user.affiliationType,
      department: user.department,
      extension: user.extension,
      role: user.role,
      status: user.status,
      createdAt: user.createdAt,
      approvedAt: user.approvedAt,
      approvedBy: user.approvedBy,
    };
  }

  async list(status?: UserStatus) {
    const users = await this.usersRepo.find({
      where: status ? { status } : {},
      order: { createdAt: 'DESC' },
    });
    return users.map((u) => this.toPublic(u));
  }

  async detail(id: string) {
    const user = await this.usersRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('회원을 찾을 수 없습니다.');

    const loginLogs = await this.loginLogRepo.find({
      where: { userId: id },
      order: { createdAt: 'DESC' },
      take: 100,
    });

    return {
      user: this.toPublic(user),
      loginLogs: loginLogs.map((l) => ({
        logId: l.logId,
        userId: l.userId,
        success: l.success,
        ip: l.ip,
        userAgent: l.userAgent,
        createdAt: l.createdAt,
      })),
    };
  }

  async activity(kind: ActivityKind = 'all', limit = 400) {
    const take = Math.min(Math.max(limit, 1), 500);
    const users = await this.usersRepo.find({ select: ['id', 'name'] });
    const nameById = new Map(users.map((u) => [u.id, u.name]));

    const loginRows =
      kind === 'export'
        ? []
        : await this.loginLogRepo.find({
            order: { createdAt: 'DESC' },
            take,
          });
    const exportRows =
      kind === 'login'
        ? []
        : await this.exportLogRepo.find({
            order: { createdAt: 'DESC' },
            take,
          });

    const loginItems = loginRows.map((l) => ({
      id: `login-${l.logId}`,
      kind: 'login' as const,
      createdAt: l.createdAt,
      userId: l.userId,
      userName: nameById.get(l.userId) ?? null,
      ip: l.ip,
      success: l.success,
      format: null as ExportFormat | null,
      filename: null as string | null,
      summary: l.success ? '로그인 성공' : '로그인 실패',
      source: null as string | null,
    }));

    const exportItems = exportRows.map((e) => ({
      id: `export-${e.exportId}`,
      kind: 'export' as const,
      createdAt: e.createdAt,
      userId: e.userId,
      userName: e.userName || nameById.get(e.userId) || null,
      ip: e.ip,
      success: true,
      format: e.format,
      filename: e.filename,
      summary: e.summary,
      source: e.source,
    }));

    return [...loginItems, ...exportItems]
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      )
      .slice(0, take);
  }

  async recordExport(input: {
    userId: string;
    userName: string;
    format: ExportFormat;
    source: string;
    filename: string;
    summary?: string | null;
    ip?: string | null;
  }) {
    const format = input.format;
    if (format !== 'xlsx' && format !== 'png' && format !== 'pdf') {
      throw new BadRequestException('지원하지 않는 내보내기 형식입니다.');
    }
    const source = input.source.trim();
    const filename = input.filename.trim();
    if (!source || !filename) {
      throw new BadRequestException('내보낸 항목 정보가 부족합니다.');
    }
    const row = await this.exportLogRepo.save(
      this.exportLogRepo.create({
        userId: input.userId,
        userName: input.userName,
        format,
        source: source.slice(0, 100),
        filename: filename.slice(0, 300),
        summary: input.summary?.trim() || null,
        ip: input.ip ?? null,
      }),
    );
    return { ok: true, exportId: row.exportId };
  }

  async approve(id: string, adminId: string) {
    const user = await this.usersRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('회원을 찾을 수 없습니다.');
    if (user.status !== 'pending') {
      throw new BadRequestException('승인 대기 상태의 회원만 승인할 수 있습니다.');
    }
    user.status = 'approved';
    user.approvedAt = new Date();
    user.approvedBy = adminId;
    await this.usersRepo.save(user);
    return this.toPublic(user);
  }

  async reject(id: string, adminId: string) {
    const user = await this.usersRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('회원을 찾을 수 없습니다.');
    if (user.status !== 'pending') {
      throw new BadRequestException('승인 대기 상태의 회원만 거절할 수 있습니다.');
    }
    if (user.role === 'admin') {
      throw new BadRequestException('관리자 계정은 거절할 수 없습니다.');
    }
    user.status = 'rejected';
    user.approvedAt = new Date();
    user.approvedBy = adminId;
    await this.usersRepo.save(user);
    return this.toPublic(user);
  }

  async resetPassword(id: string) {
    const user = await this.usersRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('회원을 찾을 수 없습니다.');
    if (user.status !== 'approved') {
      throw new BadRequestException(
        '승인된 회원만 임시 비밀번호를 재설정할 수 있습니다.',
      );
    }

    const tempPassword = this.generateTempPassword();
    user.passwordHash = await bcrypt.hash(tempPassword, 10);
    await this.usersRepo.save(user);

    const mailResult = await this.mailService.sendTempPassword(
      user.email,
      user.id,
      tempPassword,
      'admin',
    );

    return {
      ok: true,
      email: user.email,
      mail: mailResult,
      message:
        mailResult.mode === 'dev-log'
          ? '임시 비밀번호가 발급되었습니다. (개발 모드: 서버 로그 확인)'
          : `${user.email} 으로 임시 비밀번호를 발송했습니다.`,
    };
  }

  async remove(id: string, adminId: string) {
    const user = await this.usersRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('회원을 찾을 수 없습니다.');
    if (user.id === adminId) {
      throw new BadRequestException('본인 계정은 탈퇴시킬 수 없습니다.');
    }
    if (user.role === 'admin') {
      throw new BadRequestException('관리자 계정은 탈퇴시킬 수 없습니다.');
    }

    await this.loginLogRepo.delete({ userId: id });
    await this.usersRepo.delete(id);
    return { ok: true };
  }

  private generateTempPassword(): string {
    const chars =
      'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
    const bytes = crypto.randomBytes(10);
    let out = '';
    for (let i = 0; i < 10; i++) {
      out += chars[bytes[i] % chars.length];
    }
    return out;
  }
}
