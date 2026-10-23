import type { CanonicalQuestionContent } from '../../common/question-content-v3';
import { collectContentAssetIds, parseQuestionContent } from './question-content-dispatch';

export function authoringAssetIds(input: unknown): string[] { return collectContentAssetIds(parseQuestionContent(input)); }

/** Asset collection never promotes an analysis-only image into a prompt. */
export function classifyQuestionAsset(input: unknown, assetId: string): 'prompt' | 'answer' | null {
  const content = parseQuestionContent(input);
  const prompt: CanonicalQuestionContent = { ...content, analysis: null };
  if (collectContentAssetIds(prompt).includes(assetId)) return 'prompt';
  return collectContentAssetIds(content).includes(assetId) ? 'answer' : null;
}
