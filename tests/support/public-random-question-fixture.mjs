import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

// Match the tab-separated import protocol in training-question-import.mjs.
const HEADERS = ['category', 'type', 'difficulty', 'stem', 'options', 'answer', 'analysis'];
export const PUBLIC_RANDOM_RULES_100 = [
  { type: 'single', count: 60, score_cents: 100 },
  { type: 'multiple', count: 20, score_cents: 100 },
  { type: 'judgment', count: 20, score_cents: 100 },
];
export const PUBLIC_RANDOM_RULES_80 = [
  { type: 'single', count: 60, score_cents: 100 },
  { type: 'multiple', count: 10, score_cents: 300 },
  { type: 'judgment', count: 10, score_cents: 100 },
];

export function publicRandomQuestionFixture(runId = randomBytes(6).toString('hex')) {
  assert.match(runId, /^[a-zA-Z0-9]+$/);
  const questions = [];
  const batches = [];
  for (const categoryIndex of [0, 1]) {
    for (const difficulty of ['easy', 'hard']) {
      const rows = [];
      for (const [type, count] of [['single', 150], ['multiple', 50], ['judgment', 50]]) {
        for (let index = 0; index < count; index++) {
          const token = `PRX${runId}C${categoryIndex}${difficulty}${type}${String(index).padStart(3, '0')}`;
          const options = Array.from({ length: type === 'judgment' ? 2 : 4 }, (_, option) => ({
            key: String.fromCharCode(65 + option),
            text: type === 'judgment' ? ['正确', '错误'][option] : `${token}选项${option + 1}`,
          }));
          const first = index % options.length;
          const answer = type === 'multiple' ? [first, (first + 2) % options.length].sort((a, b) => a - b) : [first];
          const question = {
            token, categoryIndex, difficulty, type,
            stem: `<p>${token}：合成安全知识题，请按测试题意选择。</p>`,
            options, answer, analysis: `<p>PRIVATE_ANALYSIS_${token}</p>`,
          };
          questions.push(question);
          rows.push(question);
        }
      }
      batches.push({ categoryIndex, difficulty, questions: rows });
    }
  }
  return { runId, questions, batches, answersByToken: new Map(questions.map(question => [question.token, question])) };
}

export function questionImportTxt(questions) {
  const rows = questions.map(question => ({
    category: '', type: question.type, difficulty: question.difficulty, stem: question.stem,
    options: JSON.stringify(question.options), answer: JSON.stringify(question.answer), analysis: question.analysis,
  }));
  return Buffer.from(`\uFEFF${[HEADERS.join('\t'), ...rows.map(row => HEADERS.map(header => row[header]).join('\t'))].join('\r\n')}\r\n`, 'utf8');
}

export function questionImportMultipart(categoryId, questions) {
  assert.match(String(categoryId), /^[1-9]\d*$/);
  const boundary = `----ruleexam-public-random-${randomBytes(12).toString('hex')}`;
  return {
    body: Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="format"\r\n\r\ntxt\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="category_id"\r\n\r\n${categoryId}\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="public-random.txt"\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n`),
      questionImportTxt(questions), Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
    headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
  };
}

export function contentText(content) {
  if (typeof content === 'string') return content.replace(/<[^>]*>/g, '');
  if (!content || typeof content !== 'object') return '';
  if (content.type === 'text') return content.text || '';
  return (content.content || []).map(contentText).join('');
}

export function fixtureQuestion(item, fixture) {
  const text = contentText(item.stem);
  const token = text.match(/PRX[a-zA-Z0-9]+(?=：)/)?.[0];
  assert.ok(token && fixture.answersByToken.has(token), 'attempt must contain a question from the synthetic import');
  const question = fixture.answersByToken.get(token);
  assert.equal(item.type, question.type);
  return question;
}

// The oracle is the pre-import answer manifest. Never obtain answers from a
// learner result or infer correctness from shuffled display letters/positions.
export function fixtureAnswerSheet(attempt, fixture, mode = 'correct') {
  assert.ok(['correct', 'partial', 'wrong'].includes(mode));
  return {
    record_id: attempt.record_id,
    answers: attempt.questions.map(item => {
      const question = fixtureQuestion(item, fixture);
      const byText = new Map(question.options.map((option, index) => [contentText(option.text), index]));
      const displayed = item.options.map(option => {
        const originalIndex = byText.get(contentText(option.content));
        assert.notEqual(originalIndex, undefined, 'display option must map to an original fixture option');
        return { id: option.id, originalIndex };
      });
      assert.equal(new Set(displayed.map(option => option.originalIndex)).size, question.options.length);
      const correct = displayed.filter(option => question.answer.includes(option.originalIndex));
      const wrong = displayed.filter(option => !question.answer.includes(option.originalIndex));
      const chosen = mode === 'wrong' ? wrong.slice(0, 1)
        : mode === 'partial' && item.type === 'multiple' ? correct.slice(0, 1) : correct;
      return { item_id: item.item_id, option_ids: chosen.map(option => option.id) };
    }),
  };
}
