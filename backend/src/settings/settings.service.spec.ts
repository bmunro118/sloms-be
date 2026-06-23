import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { PrismaService } from '../prisma/prisma.service';

const mockPrisma = {
  globalSetting: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    count: jest.fn(),
    update: jest.fn(),
  },
  userSetting: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    upsert: jest.fn(),
    delete: jest.fn(),
  },
};

function makeSetting(overrides = {}) {
  return {
    key: 'site.name',
    val: 'SLOMS',
    description: 'Site name',
    exposed: true,
    ...overrides,
  };
}

function makeUserSetting(overrides = {}) {
  return {
    userId: 1,
    key: 'theme',
    val: 'dark',
    ...overrides,
  };
}

describe('SettingsService', () => {
  let service: SettingsService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SettingsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<SettingsService>(SettingsService);
  });

  describe('findAll', () => {
    it('filters to exposed settings by default', async () => {
      mockPrisma.globalSetting.findMany.mockResolvedValue([makeSetting()]);
      mockPrisma.globalSetting.count.mockResolvedValue(1);

      await service.findAll();

      expect(mockPrisma.globalSetting.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { exposed: true } }),
      );
    });

    it('includes hidden settings when flag is set', async () => {
      mockPrisma.globalSetting.findMany.mockResolvedValue([]);
      mockPrisma.globalSetting.count.mockResolvedValue(0);

      await service.findAll(true);

      expect(mockPrisma.globalSetting.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: {} }),
      );
    });

    it('returns paged result', async () => {
      mockPrisma.globalSetting.findMany.mockResolvedValue([makeSetting()]);
      mockPrisma.globalSetting.count.mockResolvedValue(1);

      const result = await service.findAll();
      expect(result.total).toBe(1);
      expect(result.data[0].key).toBe('site.name');
    });
  });

  describe('findOne', () => {
    it('throws NotFoundException when setting does not exist', async () => {
      mockPrisma.globalSetting.findUnique.mockResolvedValue(null);
      await expect(service.findOne('missing.key')).rejects.toThrow(NotFoundException);
    });

    it('returns the setting when found', async () => {
      mockPrisma.globalSetting.findUnique.mockResolvedValue(makeSetting());
      const result = await service.findOne('site.name');
      expect(result.key).toBe('site.name');
    });
  });

  describe('update', () => {
    it('throws NotFoundException when setting does not exist', async () => {
      mockPrisma.globalSetting.findUnique.mockResolvedValue(null);
      await expect(service.update('missing.key', { val: 'x' })).rejects.toThrow(NotFoundException);
    });

    it('updates and returns the setting', async () => {
      const updated = makeSetting({ val: 'New Value' });
      mockPrisma.globalSetting.findUnique
        .mockResolvedValueOnce(makeSetting())
        .mockResolvedValueOnce(updated);
      mockPrisma.globalSetting.update.mockResolvedValue(updated);

      const result = await service.update('site.name', { val: 'New Value' });
      expect(result.val).toBe('New Value');
    });
  });

  describe('getValue', () => {
    it('returns the value string', async () => {
      mockPrisma.globalSetting.findUnique.mockResolvedValue(makeSetting());
      const val = await service.getValue('site.name');
      expect(val).toBe('SLOMS');
    });

    it('returns null when val is null', async () => {
      mockPrisma.globalSetting.findUnique.mockResolvedValue(makeSetting({ val: null }));
      const val = await service.getValue('site.name');
      expect(val).toBeNull();
    });

    it('throws NotFoundException when setting does not exist', async () => {
      mockPrisma.globalSetting.findUnique.mockResolvedValue(null);
      await expect(service.getValue('missing.key')).rejects.toThrow(NotFoundException);
    });
  });

  describe('setValue', () => {
    it('throws NotFoundException when setting does not exist', async () => {
      mockPrisma.globalSetting.findUnique.mockResolvedValue(null);
      await expect(service.setValue('missing.key', 'val')).rejects.toThrow(NotFoundException);
    });

    it('updates the val field', async () => {
      const updated = makeSetting({ val: 'Updated' });
      mockPrisma.globalSetting.findUnique
        .mockResolvedValueOnce(makeSetting())
        .mockResolvedValueOnce(updated);
      mockPrisma.globalSetting.update.mockResolvedValue(updated);

      const result = await service.setValue('site.name', 'Updated');
      expect(result.val).toBe('Updated');
      expect(mockPrisma.globalSetting.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { val: 'Updated' } }),
      );
    });
  });

  describe('findUserSettings', () => {
    it('returns all settings for a user', async () => {
      mockPrisma.userSetting.findMany.mockResolvedValue([makeUserSetting()]);

      const result = await service.findUserSettings(1);

      expect(mockPrisma.userSetting.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 1 } }),
      );
      expect(result[0].key).toBe('theme');
    });
  });

  describe('findUserSetting', () => {
    it('throws NotFoundException when user setting does not exist', async () => {
      mockPrisma.userSetting.findUnique.mockResolvedValue(null);
      await expect(service.findUserSetting(1, 'missing')).rejects.toThrow(NotFoundException);
    });

    it('returns the user setting when found', async () => {
      mockPrisma.userSetting.findUnique.mockResolvedValue(makeUserSetting());
      const result = await service.findUserSetting(1, 'theme');
      expect(result.val).toBe('dark');
    });
  });

  describe('upsertUserSetting', () => {
    it('upserts and returns the user setting', async () => {
      mockPrisma.userSetting.upsert.mockResolvedValue(makeUserSetting({ val: 'light' }));

      const result = await service.upsertUserSetting(1, 'theme', { val: 'light' });

      expect(mockPrisma.userSetting.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId_key: { userId: 1, key: 'theme' } },
          create: { userId: 1, key: 'theme', val: 'light' },
          update: { val: 'light' },
        }),
      );
      expect(result.val).toBe('light');
    });
  });

  describe('deleteUserSetting', () => {
    it('throws NotFoundException when user setting does not exist', async () => {
      mockPrisma.userSetting.findUnique.mockResolvedValue(null);
      await expect(service.deleteUserSetting(1, 'missing')).rejects.toThrow(NotFoundException);
    });

    it('deletes the user setting', async () => {
      mockPrisma.userSetting.findUnique.mockResolvedValue(makeUserSetting());
      mockPrisma.userSetting.delete.mockResolvedValue(makeUserSetting());

      await service.deleteUserSetting(1, 'theme');

      expect(mockPrisma.userSetting.delete).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId_key: { userId: 1, key: 'theme' } },
        }),
      );
    });
  });
});
