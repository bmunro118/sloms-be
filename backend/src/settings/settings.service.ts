import { Injectable, NotFoundException } from '@nestjs/common';
import { PagingDto, PagedResult } from '../common/paging';
import { PrismaService } from '../prisma/prisma.service';
import { serializePrisma } from '../prisma/prisma-serializer';
import { GlobalSetting } from './entities/setting.entity';
import { UserSetting } from './entities/user-setting.entity';
import { UpdateSettingDto } from './dto/update-setting.dto';
import { UpsertUserSettingDto } from './dto/upsert-user-setting.dto';

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Global Settings ────────────────────────────────────────────────────────

  async findAll(
    includeHidden = false,
    paging = new PagingDto(),
  ): Promise<PagedResult<GlobalSetting>> {
    const where = includeHidden ? {} : { exposed: true };
    const [settings, total] = await Promise.all([
      this.prisma.globalSetting.findMany({
        where,
        orderBy: { key: 'asc' },
        skip: paging.offset,
        take: paging.limit,
      }),
      this.prisma.globalSetting.count({ where }),
    ]);

    return new PagedResult(
      serializePrisma<GlobalSetting[]>(settings),
      total,
      paging,
    );
  }

  async findOne(key: string): Promise<GlobalSetting> {
    const setting = await this.prisma.globalSetting.findUnique({
      where: { key },
    });

    if (!setting) {
      throw new NotFoundException(`Setting '${key}' not found`);
    }

    return serializePrisma<GlobalSetting>(setting);
  }

  async update(key: string, dto: UpdateSettingDto): Promise<GlobalSetting> {
    await this.findOne(key);

    await this.prisma.globalSetting.update({
      where: { key },
      data: dto,
    });

    return this.findOne(key);
  }

  async getValue(key: string): Promise<string | null> {
    const setting = await this.findOne(key);
    return setting.val ?? null;
  }

  async setValue(key: string, val: string): Promise<GlobalSetting> {
    await this.findOne(key);

    await this.prisma.globalSetting.update({
      where: { key },
      data: { val },
    });

    return this.findOne(key);
  }

  // ─── User Settings ───────────────────────────────────────────────────────────

  async findUserSettings(userId: number): Promise<UserSetting[]> {
    const settings = await this.prisma.userSetting.findMany({
      where: { userId },
      orderBy: { key: 'asc' },
    });

    return serializePrisma<UserSetting[]>(settings);
  }

  async findUserSetting(userId: number, key: string): Promise<UserSetting> {
    const setting = await this.prisma.userSetting.findUnique({
      where: { userId_key: { userId, key } },
    });

    if (!setting) {
      throw new NotFoundException(`User setting '${key}' not found`);
    }

    return serializePrisma<UserSetting>(setting);
  }

  async upsertUserSetting(
    userId: number,
    key: string,
    dto: UpsertUserSettingDto,
  ): Promise<UserSetting> {
    const setting = await this.prisma.userSetting.upsert({
      where: { userId_key: { userId, key } },
      create: { userId, key, val: dto.val ?? null },
      update: { val: dto.val ?? null },
    });

    return serializePrisma<UserSetting>(setting);
  }

  async deleteUserSetting(userId: number, key: string): Promise<void> {
    await this.findUserSetting(userId, key);
    await this.prisma.userSetting.delete({
      where: { userId_key: { userId, key } },
    });
  }
}
