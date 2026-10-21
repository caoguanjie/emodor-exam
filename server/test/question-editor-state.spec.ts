import { describe, expect, it } from 'vitest';
import * as trainingTypes from '../../web/src/api/training-types';

describe('question editor state', () => {
  it('keeps legacy unknown difficulty explicitly unselected until the editor chooses one', () => {
    const fromView = (trainingTypes as any).questionDraftFromView;
    expect(fromView).toBeTypeOf('function');

    const draft = fromView({
      question_id: '7', category_id: null, difficulty: null, type: 'single', stem: '旧题',
      options: [{ key: 'A', text: '是' }, { key: 'B', text: '否' }], answer: [0], analysis: null,
      rubric: null, score: 5, concept_id: null, regulation_id: null, regulation_version_id: null,
    });

    expect(draft.difficulty).toBe('');
  });

  it('uses a safe fallback for unsaved rich-text preview when no browser DOM is available', () => {
    const sanitize = (trainingTypes as any).sanitizeQuestionHtmlForPreview;
    expect(sanitize).toBeTypeOf('function');

    const rendered = sanitize('<img src="https://evil.test/x?a=1&b=2" onerror="steal(\'x\')"><b>"可见" & \'文本\'</b>');

    expect(rendered).toBe(
      '&lt;img src=&quot;https://evil.test/x?a=1&amp;b=2&quot; onerror=&quot;steal(&#39;x&#39;)&quot;&gt;'
      + '&lt;b&gt;&quot;可见&quot; &amp; &#39;文本&#39;&lt;/b&gt;',
    );
    expect(rendered).not.toContain('<img');
    expect(rendered).not.toContain('<b>');
  });
});
