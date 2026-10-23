import { describe, expect, it } from 'vitest';
import { classifyQuestionAsset, authoringAssetIds } from '../src/modules/questions/question-authoring-media';

const paragraph = (asset: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'image', attrs: { asset_id: asset } }] }] });
const content = { schema: 3, stem: paragraph('42'), options: [{ id: 'A', content: paragraph('43') }, { id: 'B', content: paragraph('44') }], analysis: paragraph('45'), answer_option_ids: ['A'] };

describe('authoring media scope', () => {
  it('classifies analysis-only assets as answer media instead of granting prompt access', () => {
    expect(classifyQuestionAsset(content, '42')).toBe('prompt');
    expect(classifyQuestionAsset(content, '43')).toBe('prompt');
    expect(classifyQuestionAsset(content, '45')).toBe('answer');
    expect(classifyQuestionAsset(content, '99')).toBeNull();
  });
  it('collects all controlled authoring media while rejecting external image attrs', () => {
    expect(authoringAssetIds(content)).toEqual(['42', '43', '44', '45']);
    const unsafe = structuredClone(content); Object.assign(unsafe.analysis.content[0].content[0].attrs, { src: 'https://external.test/x' });
    expect(() => authoringAssetIds(unsafe)).toThrow();
  });
});
