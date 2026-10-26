import { describe, expect, it } from 'vitest';
import type { AuthoringBundle } from '../src/common/question-authoring';
import { Question } from '../src/entities/question.entity';
import { QuestionVersion } from '../src/entities/question-version.entity';
import { QuestionAuthoringCommit } from '../src/entities/question-authoring-commit.entity';
import { QuestionVersionService } from '../src/modules/questions/question-version.service';
import { QuestionAuthoringService } from '../src/modules/questions/question-authoring.service';
import { decodeAuthoringBundle } from '../src/modules/questions/question-authoring-codec';
import { parseQuestionContent, projectStudentContent } from '../src/modules/questions/question-content-dispatch';

function bundle(ids = ['local1']): AuthoringBundle {
  const text = (value: string) => ({ type: 'paragraph', content: [{ type: 'text', text: value }] });
  return {
    document: { schema_version: 1, content: { type: 'doc', content: ids.map((id) => ({ type: 'questionBlock', attrs: { client_id: id }, content: [
      { type: 'questionStem', content: [text(`题干 ${id}`)] },
      { type: 'questionOption', attrs: { option_id: 'A', checked: true }, content: [text('是')] },
      { type: 'questionOption', attrs: { option_id: 'B', checked: false }, content: [text('否')] },
    ] })) }, questions: Object.fromEntries(ids.map((id) => [id, { type: 'single', category_id: '11', difficulty: 'easy',
      regulation_id: null, regulation_version_id: null, score_cents: 500, analysis: { type: 'doc', content: [text('解析')] } }])) },
    identities: {}, option_ids: Object.fromEntries(ids.map((id) => [id, { A: 'A', B: 'B' }])), layouts: {},
  };
}

/** Only the external persistence boundary is replaced; both business services are real. */
function fixture(options: { inProgress?: boolean; legacyLinked?: boolean } = {}) {
  type Row = Record<string, any>;
  let state: { questions: Row[]; versions: Row[]; receipts: Row[]; media: Row[] } = { questions: [], versions: [], receipts: [], media: [] };
  let nextId = 1;
  const repo = (table: keyof typeof state) => ({
    create: (value: Row) => ({ ...value }),
    findOne: async ({ where }: { where: Row }) => state[table].find((row) => Object.entries(where).every(([key, value]) => row[key] === value)) || null,
    insert: async (value: Row) => {
      if (state[table].some((row) => row.ownerId === value.ownerId && row.requestId === value.requestId)) throw Object.assign(new Error('duplicate'), { code: 'ER_DUP_ENTRY' });
      const row = { ...structuredClone(value), id: String(nextId++) }; state[table].push(row); return { identifiers: [{ id: row.id }] };
    },
    save: async (value: Row) => {
      if (!value.id) value.id = String(nextId++);
      const index = state[table].findIndex((row) => row.id === value.id);
      if (index < 0) state[table].push(value); else state[table][index] = value;
      return value;
    },
  });
  const manager: any = { query: async (sql: string) => sql.includes('exam_record') ? (options.inProgress ? [{ blocked: 1 }] : []) : (options.legacyLinked ? [{ blocked: 1 }] : []), getRepository(entity: unknown) {
    if (entity === Question) return repo('questions'); if (entity === QuestionVersion) return repo('versions');
    if (entity === QuestionAuthoringCommit) return repo('receipts'); throw new Error('unexpected repository');
  } };
  let tail: Promise<unknown> = Promise.resolve();
  const dataSource: any = { getRepository: manager.getRepository, transaction: (work: (m: any) => Promise<unknown>) => {
    const task = tail.then(async () => { const before = structuredClone(state); try { return await work(manager); } catch (error) { state = before; throw error; } });
    tail = task.catch(() => undefined); return task;
  } };
  const access: any = { permissions: async (id: string) => id === '99' ? [] : ['questions:read', 'questions:write'] };
  const versions = new QuestionVersionService(repo('questions') as any, repo('versions') as any,
    { findOne: async () => ({ id: '2' }) } as any, { findOne: async () => ({ id: '3' }) } as any,
    dataSource, { lockActive: async (_m: unknown, id: string) => { if (id === '22') throw new Error('inactive category'); } } as any,
    { assertUsable: async (_actor: string, id: string) => { if (id === '999') throw new Error('unusable media'); },
      bind: async (_m: unknown, assetId: string, ownerType: string, businessId: string) => { state.media.push({ assetId, ownerType, businessId }); } } as any, access);
  const service = new QuestionAuthoringService(dataSource, versions, access);
  return { service, versions, state: () => state };
}
const requestId = '75d17f2e-1c29-4bf7-b5da-660a3b116eba';

describe('authoring transaction with the real version service', () => {
  it('rejects a bound deleted identity before idempotent content matching or compatibility projection can revive it', async () => {
    const f = fixture();
    const first = await f.service.commit({ request_id: requestId, bundle: bundle() }, '9');
    Object.assign(f.state().questions[0], { deletedAt: new Date('2026-10-26T02:00:00.000Z'), isEnabled: false });
    const input = structuredClone(first.bundle); input.identities.local1.expected_enabled = false;
    const before = structuredClone(f.state());
    await expect(f.service.commit({ request_id: '84df8ef9-32a9-4112-ac24-3e8f5d2ef711', bundle: input }, '9')).rejects.toMatchObject({ code: 40401 });
    expect(f.state()).toEqual(before);
  });
  it('rejects stale enabled authoring tokens at the same revision and accepts only an explicit refreshed save', async () => {
    const f = fixture();
    const first = await f.service.commit({ request_id: requestId, bundle: bundle() }, '9');
    f.state().questions[0].isEnabled = false;
    const before = structuredClone(f.state());
    const stale = structuredClone(first.bundle);
    stale.document.questions.local1.difficulty = 'hard';
    await expect(f.service.commit({ request_id: '84df8ef9-32a9-4112-ac24-3e8f5d2ef711', bundle: stale }, '9')).rejects.toMatchObject({ code: 40940 });
    expect(f.state()).toEqual(before);
    const refreshed = await f.service.assemble([first.items[0].saved_version_id], '9');
    expect(refreshed.identities.local1.expected_enabled).toBe(false);
    const next = await f.service.commit({ request_id: 'c938f798-b80e-4aba-a288-73467f12a0ee', bundle: refreshed }, '9');
    expect(next.items[0].revision).toBe(2);
    expect(f.state().questions[0].isEnabled).toBe(true);
    expect(f.state().versions[1]).toMatchObject({ approvedBy: null, reviewedBy: null, conceptId: null, scoreCents: null });
  });

  it('requires an enabled baseline only for bound identities and strips historical concepts from edit projections', async () => {
    const f = fixture();
    const first = await f.service.commit({ request_id: requestId, bundle: bundle() }, '9');
    const legacy = f.state().versions[0];
    legacy.conceptId = '7'; legacy.authoringJson.document.questions.local1.concept_id = '7';
    delete legacy.authoringJson.identities.local1.expected_enabled;
    const history = structuredClone(legacy);
    const assembled = await f.service.assemble([first.items[0].saved_version_id], '9');
    expect(assembled.document.questions.local1).not.toHaveProperty('concept_id');
    expect(legacy).toEqual(history);
    const invalid = structuredClone(assembled); delete (invalid.identities.local1 as any).expected_enabled;
    await expect(f.service.commit({ request_id: '84df8ef9-32a9-4112-ac24-3e8f5d2ef711', bundle: invalid }, '9')).rejects.toMatchObject({ code: 40001 });
    const derived = structuredClone(assembled); derived.identities = {};
    delete derived.document.questions.local1.question_id; delete derived.document.questions.local1.base_revision;
    const copied = await f.service.commit({ request_id: 'c938f798-b80e-4aba-a288-73467f12a0ee', bundle: derived }, '9');
    expect(copied.items[0].question_id).not.toBe(first.items[0].question_id);
    expect(f.state().versions[1].conceptId).toBeNull();
  });

  it('rejects concept fields in new authoring requests before any persistence', async () => {
    const f = fixture(); const input = bundle(); input.document.questions.local1.concept_id = null;
    await expect(f.service.commit({ request_id: requestId, bundle: input }, '9')).rejects.toMatchObject({ code: 40001 });
    expect(f.state()).toEqual({ questions: [], versions: [], receipts: [], media: [] });
  });
  it('stores score-free question facts, assembles without a default and keeps paper score changes out of revisions', async () => {
    const f = fixture();
    const first = await f.service.commit({ request_id: requestId, bundle: bundle() }, '9');
    expect(f.state().questions[0].score).toBeNull();
    expect(f.state().versions[0].scoreCents).toBeNull();
    expect(f.state().versions[0].authoringJson.document.questions.local1).not.toHaveProperty('score_cents');
    expect(first.bundle.document.questions.local1.score_cents).toBe(500);
    const assembled = await f.service.assemble([first.items[0].saved_version_id], '9');
    expect(assembled.document.questions.local1).not.toHaveProperty('score_cents');
    expect(decodeAuthoringBundle(assembled)).toHaveLength(1);
    const changed = structuredClone(first.bundle); changed.document.questions.local1.score_cents = 800;
    const before = structuredClone(f.state().versions);
    const receipt = await f.service.commit({ request_id: 'c938f798-b80e-4aba-a288-73467f12a0ee', bundle: changed }, '9');
    expect(receipt.items[0]).toEqual(first.items[0]);
    expect(receipt.bundle.document.questions.local1.score_cents).toBe(800);
    expect(f.state().versions).toEqual(before);
    expect(f.state().questions[0].status).toBe('approved');
  });

  it('does not create a revision or rewrite historical scores when only a paper score changes on an old version without authoring', async () => {
    const f = fixture(); const first = await f.service.commit({ request_id: requestId, bundle: bundle() }, '9');
    Object.assign(f.state().versions[0], { authoringJson: null, authoringSchemaVersion: null, scoreCents: 725 });
    f.state().questions[0].score = '7.25';
    const assembled = await f.service.assemble([first.items[0].saved_version_id], '9');
    const client = Object.keys(assembled.document.questions)[0];
    expect(assembled.document.questions[client]).not.toHaveProperty('score_cents');
    assembled.document.questions[client].score_cents = 800;
    const before = structuredClone({ questions: f.state().questions, versions: f.state().versions });
    const receipt = await f.service.commit({ request_id: 'c938f798-b80e-4aba-a288-73467f12a0ee', bundle: assembled }, '9');
    expect(receipt.items[0].saved_version_id).toBe(first.items[0].saved_version_id);
    expect({ questions: f.state().questions, versions: f.state().versions }).toEqual(before);
  });

  it('creates and revises a manual question with no score at the persistence boundary', async () => {
    const f = fixture();
    const draft = { categoryId: '11', difficulty: 'easy' as const, type: 'single' as const, source: 'manual' as const,
      stem: '题干', options: [{ key: 'A', text: '是' }, { key: 'B', text: '否' }], answer: [0], analysis: null };
    const first = await f.versions.create(draft as any, '9');
    const nextId = await f.versions.revise(first.questionId, { ...draft, analysis: '新解析' } as any, '9', first.versionId, true);
    expect(f.state().questions[0].score).toBeNull();
    expect(f.state().versions).toHaveLength(2);
    for (const row of f.state().versions) {
      expect(row.scoreCents).toBeNull();
      expect(Object.values<any>(row.authoringJson.document.questions)[0]).not.toHaveProperty('score_cents');
    }
    expect(nextId).not.toBe(first.versionId);
  });

  it.each(['top-level images', 'empty text nodes', 'ordinary nonempty nodes'])('creates, revises and assembles schema 2 %s through a valid author copy without changing exam content', async (kind) => {
    const textDoc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
    const imageDoc = (asset: string) => ({ type: 'doc', content: [{ type: 'image', attrs: { asset_id: asset } }] });
    const paragraphImageDoc = (asset: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'image', attrs: { asset_id: asset } }] }] });
    const emptyTextDoc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '' }, { type: 'text', text }, { type: 'text', text: '' }] }] });
    const raw = { stem: kind === 'top-level images' ? imageDoc('42') : kind === 'empty text nodes' ? emptyTextDoc('原题干') : textDoc('原题干'),
      options: [{ id: 'A', content: kind === 'top-level images' ? imageDoc('43') : kind === 'empty text nodes' ? emptyTextDoc('甲') : textDoc('甲') }, { id: 'B', content: textDoc('乙') }],
      analysis: kind === 'top-level images' ? imageDoc('44') : kind === 'empty text nodes' ? emptyTextDoc('解析') : textDoc('解析'), answer_option_ids: ['A'] };
    const expectedAuthorExam = { schema: 3, stem: kind === 'top-level images' ? paragraphImageDoc('42') : textDoc('原题干'),
      options: [{ id: 'A', content: kind === 'top-level images' ? paragraphImageDoc('43') : textDoc('甲') }, { id: 'B', content: textDoc('乙') }],
      analysis: kind === 'top-level images' ? paragraphImageDoc('44') : textDoc('解析'), answer_option_ids: ['A'] };
    const before = structuredClone(raw);
    const input = { categoryId: '11', difficulty: 'easy' as const, type: 'single' as const, source: 'manual' as const,
      scoreCents: 500, stem: '', options: [], answer: [], analysis: null, contentSchemaVersion: 2, contentJson: raw };
    const f = fixture();
    const first = await f.versions.create(input, '9');
    const version = f.state().versions.find((item) => item.id === first.versionId)!;
    expect(version.contentSchemaVersion).toBe(2);
    expect(version.contentJson).toEqual(before);
    expect(projectStudentContent(parseQuestionContent(version))).toEqual({ stem: before.stem, options: before.options });
    expect(decodeAuthoringBundle(version.authoringJson)[0].content).toEqual(expectedAuthorExam);
    const assembled = await f.service.assemble([first.versionId], '9');
    expect(decodeAuthoringBundle(assembled)[0].content).toEqual(expectedAuthorExam);
    const nextId = await f.versions.revise(first.questionId, { ...input, difficulty: 'hard' }, '9', first.versionId, true);
    const next = f.state().versions.find((item) => item.id === nextId)!;
    expect(next).toMatchObject({ contentSchemaVersion: 2, status: 'approved', difficulty: 'hard' });
    expect(next.contentJson).toEqual(before);
    expect(projectStudentContent(parseQuestionContent(next))).toEqual({ stem: before.stem, options: before.options });
    expect(decodeAuthoringBundle(await f.service.assemble([nextId], '9'))[0].content).toEqual(expectedAuthorExam);
    expect(raw).toEqual(before);
  });

  it('saves an approved manual version and assembles its exact version with short option ids', async () => {
    const f = fixture();
    const receipt = await f.service.commit({ request_id: requestId, bundle: bundle() }, '9');
    expect(receipt.items).toHaveLength(1);
    const version = f.state().versions[0];
    expect(version).toMatchObject({ revision: 1, status: 'approved', source: 'manual', approvedBy: null, contentSchemaVersion: 3, authoringSchemaVersion: 1 });
    const assembled = await f.service.assemble([receipt.items[0].saved_version_id], '9');
    expect(Object.values(assembled.option_ids)[0]).toEqual({ A: 'A', B: 'B' });
    expect(assembled.document.content.content?.[0].content?.[0].content?.[0].content?.[0].text).toBe('题干 local1');
  });

  it('saves a sourceful paper edit as a new manual question without mutating the AI source or allowing forged provenance', async () => {
    const f = fixture(); const first = await f.service.commit({ request_id: requestId, bundle: bundle() }, '9');
    Object.assign(f.state().questions[0], { source: 'ai', regulationId: '30', versionId: '31' });
    Object.assign(f.state().versions[0], { source: 'ai', regulationId: '30', regulationVersionId: '31' });
    Object.assign(f.state().versions[0].authoringJson.document.questions.local1, { regulation_id: '30', regulation_version_id: '31' });
    const source = await f.service.assemble([first.items[0].saved_version_id], '9');
    expect(source.document.questions.local1).toMatchObject({ regulation_id: '30', regulation_version_id: '31' });
    const before = structuredClone(f.state());
    const copy = structuredClone(source); copy.identities = {};
    delete copy.document.questions.local1.question_id; delete copy.document.questions.local1.base_revision;
    copy.document.questions.local1.difficulty = 'hard';
    await expect(f.service.commit({ request_id: '84df8ef9-32a9-4112-ac24-3e8f5d2ef711', bundle: copy }, '9')).rejects.toMatchObject({ code: 40001 });
    expect(f.state()).toEqual(before);
    Object.assign(copy.document.questions.local1, { regulation_id: null, regulation_version_id: null });
    const saved = await f.service.commit({ request_id: 'c938f798-b80e-4aba-a288-73467f12a0ee', bundle: copy }, '9');
    expect(saved.items[0].question_id).not.toBe(first.items[0].question_id);
    expect(f.state().questions).toHaveLength(2); expect(f.state().versions).toHaveLength(2);
    expect(f.state().questions[0]).toEqual(before.questions[0]); expect(f.state().versions[0]).toEqual(before.versions[0]);
    expect(f.state().versions[1]).toMatchObject({ source: 'manual', regulationId: null, regulationVersionId: null, difficulty: 'hard', status: 'approved', revision: 1 });
    const reopened = await f.service.assemble([saved.items[0].saved_version_id], '9');
    expect(reopened.document.questions.local1).toMatchObject({ regulation_id: null, regulation_version_id: null });
    expect(reopened.identities.local1).toEqual({ question_id: saved.items[0].question_id, expected_version_id: saved.items[0].saved_version_id, expected_enabled: true });
  });

  it('rolls back the first question and reservation when the second relation fails', async () => {
    const f = fixture(); const input = bundle(['one', 'two']); input.document.questions.two.category_id = '22';
    await expect(f.service.commit({ request_id: requestId, bundle: input }, '9')).rejects.toThrow('inactive category');
    expect(f.state()).toEqual({ questions: [], versions: [], receipts: [], media: [] });
  });

  it('replays the immutable receipt after response loss and rejects changed content or another owner read', async () => {
    const f = fixture(); const input = { request_id: requestId.toUpperCase(), bundle: bundle() };
    const saved = await f.service.commit(input, '9');
    expect(await f.service.getCommit(requestId, '9')).toEqual(saved);
    expect(await f.service.commit(input, '9')).toEqual(saved);
    expect(f.state().versions).toHaveLength(1);
    input.bundle.document.questions.local1.score_cents = 600;
    await expect(f.service.commit(input, '9')).rejects.toMatchObject({ code: 40940 });
    await expect(f.service.getCommit(requestId, '8')).rejects.toMatchObject({ code: 40401 });
  });

  it('keeps the actual source while revising and writes enabled with exact conflict rollback', async () => {
    const f = fixture(); const first = await f.service.commit({ request_id: requestId, bundle: bundle() }, '9');
    f.state().versions[0].source = 'import'; f.state().questions[0].source = 'import';
    const next = structuredClone(first.bundle); next.document.questions.local1.difficulty = 'hard';
    const updated = await f.service.commit({ request_id: '84df8ef9-32a9-4112-ac24-3e8f5d2ef711', bundle: next }, '9');
    expect(f.state().versions[1]).toMatchObject({ source: 'import', status: 'approved', revision: 2 });
    const before = structuredClone(f.state());
    await expect(f.service.commit({ request_id: 'c938f798-b80e-4aba-a288-73467f12a0ee', bundle: next }, '9')).rejects.toMatchObject({ code: 40940 });
    expect(f.state()).toEqual(before);
    expect((await f.service.assemble([first.items[0].saved_version_id], '9')).identities.local1.expected_version_id).toBe(first.items[0].saved_version_id);
    expect(updated.items[0].revision).toBe(2);
  });

  it('rejects source spoofing and read permission failures before persistence', async () => {
    const f = fixture(); const input = bundle(); Object.assign(input.document.questions.local1, { source: 'ai' });
    await expect(f.service.commit({ request_id: requestId, bundle: input }, '9')).rejects.toMatchObject({ code: 40001 });
    await expect(f.service.assemble(['1'], '99')).rejects.toMatchObject({ code: 40301 });
    expect(f.state().versions).toEqual([]);
  });

  it('converges simultaneous retries on one committed receipt', async () => {
    const f = fixture(); const request = { request_id: requestId, bundle: bundle() };
    const [first, second] = await Promise.all([f.service.commit(request, '9'), f.service.commit(request, '9')]);
    expect(second).toEqual(first); expect(f.state().versions).toHaveLength(1);
    expect(f.state().receipts).toHaveLength(1); expect(f.state().receipts[0].resultJson).not.toBeNull();
  });

  it('assembles distinct versions whose original documents reused a local client id', async () => {
    const f = fixture(); const first = await f.service.commit({ request_id: requestId, bundle: bundle() }, '9');
    const second = await f.service.commit({ request_id: 'c938f798-b80e-4aba-a288-73467f12a0ee', bundle: bundle() }, '9');
    const assembled = await f.service.assemble([first.items[0].saved_version_id, second.items[0].saved_version_id], '9');
    expect(Object.keys(assembled.identities)).toHaveLength(2);
    expect(Object.values(assembled.identities).map((token) => token.expected_version_id)).toEqual([first.items[0].saved_version_id, second.items[0].saved_version_id]);
    expect(assembled.document.content.content).toHaveLength(2);
  });

  it('assembles an old exact version without writing invented historical formatting', async () => {
    const f = fixture();
    const legacy = { id: '71', questionId: '4', revision: 1, categoryId: '11', difficulty: 'medium', type: 'single',
      stem: '<p>旧题</p>', options: [{ key: 'A', text: '是' }, { key: 'B', text: '否' }], answer: [0], analysis: null,
      contentSchemaVersion: 1, contentJson: null, authoringJson: null, scoreCents: 500, conceptId: null, regulationId: null, regulationVersionId: null };
    f.state().versions.push(legacy); f.state().questions.push({ id: '4', isEnabled: false, currentVersionId: '71' }); const before = structuredClone(f.state());
    const value = await f.service.assemble(['71'], '9');
    expect(value.option_ids.version_71).toEqual({ A: 'A', B: 'B' });
    expect(value.identities.version_71).toEqual({ question_id: '4', expected_version_id: '71', expected_enabled: false });
    expect(value.document.questions.version_71.difficulty).toBe('medium');
    expect(f.state()).toEqual(before);
  });

  it('rolls back authoring, media bindings and receipt when a later image is unusable', async () => {
    const f = fixture(); const value = bundle(['one', 'two']);
    value.document.content.content![0].content![0].content![0].content!.push({ type: 'mediaImage', attrs: { asset_id: '42', alt: null } });
    value.document.content.content![1].content![0].content![0].content!.push({ type: 'mediaImage', attrs: { asset_id: '999', alt: null } });
    await expect(f.service.commit({ request_id: requestId, bundle: value }, '9')).rejects.toThrow('unusable media');
    expect(f.state()).toEqual({ questions: [], versions: [], receipts: [], media: [] });
  });

  it('keeps a schema 3 form revision rich and reopens synchronized content from the new version', async () => {
    const f = fixture(); const value = bundle(); value.document.content.content![0].content![0].content![0].content![0].marks = [{ type: 'bold' }];
    const first = await f.service.commit({ request_id: requestId, bundle: value }, '9'); const version = f.state().versions[0];
    const savedId = await f.versions.revise(first.items[0].question_id, { categoryId: '11', difficulty: 'hard', type: 'single', source: 'manual',
      scoreCents: 500, stem: version.stem, options: version.options, answer: [1], analysis: version.analysis,
      contentSchemaVersion: 3, contentJson: { ...version.contentJson, answer_option_ids: ['B'] } }, '9', first.items[0].saved_version_id, true);
    const next = f.state().versions.find((item) => item.id === savedId)!;
    expect(next).toMatchObject({ contentSchemaVersion: 3, status: 'approved', difficulty: 'hard' });
    expect(next.contentJson.stem).toEqual(version.contentJson.stem);
    const reopened = await f.service.assemble([savedId], '9');
    expect(reopened.document.questions.local1.difficulty).toBe('hard');
    expect(reopened.document.content.content![0].content![2].attrs!.checked).toBe(true);
    expect(reopened.document.content.content![0].content![0].content![0].content![0].marks).toEqual([{ type: 'bold' }]);
  });

  it('preserves schema 3 on a metadata-only old-form patch without canonical fields', async () => {
    const f = fixture(); const value = bundle(); value.document.content.content![0].content![0].content![0].content![0].marks = [{ type: 'bold' }];
    const first = await f.service.commit({ request_id: requestId, bundle: value }, '9'); const version = f.state().versions[0];
    const saved = await f.versions.revise(first.items[0].question_id, { categoryId: '11', difficulty: 'hard', type: 'single', source: 'manual',
      scoreCents: 600, stem: version.stem, options: version.options, answer: [1], analysis: version.analysis }, '9', first.items[0].saved_version_id, true);
    const next = f.state().versions.find((item) => item.id === saved)!;
    expect(next.contentSchemaVersion).toBe(3); expect(next.contentJson.stem).toEqual(version.contentJson.stem);
    expect(next.contentJson.answer_option_ids).toEqual(['B']);
    expect(next.authoringJson.document.questions.local1).not.toHaveProperty('score_cents');
  });

  it('enforces the existing live-exam editing gate for the new authoring endpoint', async () => {
    const f = fixture({ inProgress: true }); const first = await f.service.commit({ request_id: requestId, bundle: bundle() }, '9');
    const changed = structuredClone(first.bundle); changed.document.questions.local1.difficulty = 'hard';
    const before = structuredClone(f.state());
    await expect(f.service.commit({ request_id: 'c938f798-b80e-4aba-a288-73467f12a0ee', bundle: changed }, '9')).rejects.toMatchObject({ code: 40908 });
    expect(f.state()).toEqual(before);
  });

  it('rejects a lossy form revision without persisting authoring, compatibility or media changes', async () => {
    const f = fixture(); const value = bundle();
    value.document.content.content![0].content![0].content![0].content![0].marks = [{ type: 'bold' }];
    const first = await f.service.commit({ request_id: requestId, bundle: value }, '9'); const version = f.state().versions[0];
    const before = structuredClone(f.state());
    await expect(f.versions.revise(first.items[0].question_id, { categoryId: '11', difficulty: 'easy', type: 'single', source: 'manual',
      scoreCents: 500, stem: '<p>被打平的新题干</p>', options: version.options, answer: [0], analysis: version.analysis }, '9', first.items[0].saved_version_id, true)).rejects.toMatchObject({ code: 40001 });
    expect(f.state()).toEqual(before);
  });
});
