// GUI 测试环境准备：独立 Mock AI（OpenAI 兼容 /chat/completions，127.0.0.1:9101）
// 从 tests/e2e-smoke.mjs 抽取，仅用于本地 GUI 测试环境准备。
import http from 'node:http';

const MOCK_PORT = 9101;

function buildMockQuestions() {
  const singles = [];
  for (let i = 1; i <= 10; i++) {
    const correct = (i - 1) % 4;
    singles.push({
      type: 'single',
      stem: `【Mock】制度第${i}章规定的核心要求是什么？`,
      options: [
        { key: 'A', text: `第${i}章要求A${correct === 0 ? '（正确）' : ''}` },
        { key: 'B', text: `第${i}章要求B${correct === 1 ? '（正确）' : ''}` },
        { key: 'C', text: `第${i}章要求C${correct === 2 ? '（正确）' : ''}` },
        { key: 'D', text: `第${i}章要求D${correct === 3 ? '（正确）' : ''}` },
      ],
      answer: [correct],
      analysis: `依据第${i}章原文要点。`,
    });
  }
  const multiples = [];
  for (let i = 1; i <= 5; i++) {
    multiples.push({
      type: 'multiple',
      stem: `【Mock】以下哪些属于第${i}部分规定的适用范围？`,
      options: [
        { key: 'A', text: `范围甲（正确）` },
        { key: 'B', text: `范围乙（正确）` },
        { key: 'C', text: `范围丙` },
        { key: 'D', text: `范围丁` },
      ],
      answer: [0, 1],
      analysis: `依据第${i}部分适用范围条款。`,
    });
  }
  return [...singles, ...multiples];
}

const MOCK_QUESTIONS = buildMockQuestions();

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url.endsWith('/chat/completions')) {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      let prompt = '';
      try {
        const parsed = JSON.parse(body);
        prompt = (parsed.messages || []).map((m) => m.content).join('\n');
      } catch { /* ignore */ }
      console.log(`[mock-ai] ${new Date().toISOString()} chat/completions prompt_len=${prompt.length}`);
      if (prompt.includes('请回复 OK')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }));
        return;
      }
      const wantOne = prompt.includes('重新命制 1 道');
      const list = wantOne ? [MOCK_QUESTIONS[0]] : MOCK_QUESTIONS;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(list) } }] }));
    });
    return;
  }
  res.writeHead(404);
  res.end();
});

server.listen(MOCK_PORT, '127.0.0.1', () => console.log(`[mock-ai] listening on http://127.0.0.1:${MOCK_PORT}`));
