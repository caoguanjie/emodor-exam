import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { RegulationVersionService, type UploadResult } from '../src/modules/regulations/regulation-version.service';
import { QuestionMaterialsService } from '../src/modules/question-materials/question-materials.service';

const MATERIAL_ID = '9007199254740995';
const VERSION_ID = '9007199254740993';
const actor = { id: 9, name: 'admin' };

function materialRepository() {
  return {
    findOne: vi.fn(async () => ({ id: MATERIAL_ID, category: 'question_material', title: '资料' })),
  } as any;
}

describe('regulation version BIGINT identifiers', () => {
  it('keeps an uploaded version ID exact through storage result, material response, and parse enqueue', async () => {
    const uploadDir = mkdtempSync(join(tmpdir(), 'ruleexam-version-id-'));
    try {
      const materialRepo = materialRepository();
      const savedVersion = {
        id: VERSION_ID,
        regulationId: MATERIAL_ID,
        versionNo: 1,
        fileType: 'pdf',
        fileHash: 'stored-hash',
        parseStatus: 'pending',
      };
      const transactionRepo = {
        create: vi.fn((value: object) => value),
        save: vi.fn(async () => savedVersion),
      };
      const versionRepo = {
        findOne: vi.fn(async () => null),
        createQueryBuilder: vi.fn(() => ({
          select: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          getRawOne: vi.fn(async () => ({ maxNo: 0 })),
        })),
      } as any;
      const audit = { log: vi.fn() };
      const versions = new RegulationVersionService(
        materialRepo,
        versionRepo,
        { upload: { dir: uploadDir, maxUploadSizeMb: 50 } } as any,
        audit as any,
        { transaction: (work: (manager: any) => Promise<unknown>) => work({ getRepository: () => transactionRepo }) } as any,
      );
      let storageResult: UploadResult | undefined;
      const recordingVersions = {
        upload: async (...args: Parameters<RegulationVersionService['upload']>) => {
          storageResult = await versions.upload(...args);
          return storageResult;
        },
      };
      const enqueue = vi.fn();
      const materials = new QuestionMaterialsService(
        materialRepo,
        versionRepo,
        recordingVersions as any,
        { enqueue } as any,
        audit as any,
      );

      const response = await materials.upload(MATERIAL_ID, {
        originalname: '资料.pdf', buffer: Buffer.from('%PDF-1.4\n'),
      } as Express.Multer.File, actor, null);

      expect(storageResult?.version_id).toBe(VERSION_ID);
      expect(response.id).toBe(VERSION_ID);
      expect(enqueue).toHaveBeenCalledWith(VERSION_ID);
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
        detail: expect.objectContaining({ regulation_id: MATERIAL_ID }),
      }));
    } finally {
      rmSync(uploadDir, { recursive: true, force: true });
    }
  });

  it('keeps a retried version ID exact through storage result and parse enqueue', async () => {
    const materialRepo = materialRepository();
    const version = {
      id: VERSION_ID,
      regulationId: MATERIAL_ID,
      versionNo: 2,
      fileType: 'pdf',
      parseStatus: 'failed',
      retryCount: 0,
    };
    const versionRepo = {
      findOne: vi.fn(async () => version),
      save: vi.fn(async (value: unknown) => value),
    } as any;
    const audit = { log: vi.fn() };
    const versions = new RegulationVersionService(
      materialRepo,
      versionRepo,
      { upload: { dir: '/unused', maxUploadSizeMb: 50 } } as any,
      audit as any,
      {} as any,
    );
    let storageResult: Awaited<ReturnType<RegulationVersionService['retryParse']>> | undefined;
    const recordingVersions = {
      retryParse: async (...args: Parameters<RegulationVersionService['retryParse']>) => {
        storageResult = await versions.retryParse(...args);
        return storageResult;
      },
    };
    const enqueue = vi.fn();
    const materials = new QuestionMaterialsService(
      materialRepo,
      versionRepo,
      recordingVersions as any,
      { enqueue } as any,
      audit as any,
    );

    const response = await materials.retry(MATERIAL_ID, VERSION_ID, actor, null);

    expect(storageResult?.version_id).toBe(VERSION_ID);
    expect(response.id).toBe(VERSION_ID);
    expect(enqueue).toHaveBeenCalledWith(VERSION_ID);
  });
});
