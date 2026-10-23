import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

export interface DropPoint {
  x: number;
  y: number;
}

export interface DropRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface QuestionDropGeometry {
  canvas: DropRect;
  questions: Array<{
    clientId: string;
    rect: DropRect;
    stem?: DropRect;
    options: Array<{ optionId: string; rect: DropRect }>;
  }>;
}

type PositionedQuestion = QuestionDropGeometry['questions'][number] & {
  position: number;
  node: ProseMirrorNode;
};

function contains(rect: DropRect, point: DropPoint): boolean {
  return point.x >= rect.left
    && point.x <= rect.right
    && point.y >= rect.top
    && point.y <= rect.bottom;
}

function positionedQuestions(
  document: ProseMirrorNode,
  geometry: QuestionDropGeometry,
): PositionedQuestion[] | null {
  const byClientId = new Map(geometry.questions.map((question) => [question.clientId, question]));
  const result: PositionedQuestion[] = [];
  let valid = true;

  document.forEach((node, position) => {
    if (node.type.name !== 'questionBlock') {
      valid = false;
      return;
    }
    const clientId = String(node.attrs.client_id ?? '');
    const question = byClientId.get(clientId);
    if (!clientId || !question) {
      valid = false;
      return;
    }
    result.push({ ...question, position, node });
  });

  return valid && result.length === document.childCount && result.length === geometry.questions.length
    ? result
    : null;
}

function contentPosition(
  question: PositionedQuestion,
  target: 'stem' | { optionId: string },
): number | null {
  let result: number | null = null;
  question.node.forEach((child, offset) => {
    if (result !== null) return;
    if (target === 'stem' && child.type.name === 'questionStem') {
      result = question.position + 2 + offset;
      return;
    }
    if (
      target !== 'stem'
      && child.type.name === 'questionOption'
      && child.attrs.option_id === target.optionId
    ) {
      result = question.position + 2 + offset;
    }
  });
  return result;
}

function mappedPositionMatches(
  document: ProseMirrorNode,
  mappedPosition: number,
  clientId: string,
  target: 'stem' | { optionId: string },
): boolean {
  if (!Number.isInteger(mappedPosition) || mappedPosition < 0 || mappedPosition > document.content.size) {
    return false;
  }
  const $position = document.resolve(mappedPosition);
  let matchedQuestion = false;
  let matchedContent = false;
  for (let depth = $position.depth; depth > 0; depth -= 1) {
    const node = $position.node(depth);
    if (node.type.name === 'questionBlock') {
      matchedQuestion = String(node.attrs.client_id ?? '') === clientId;
    }
    if (target === 'stem' && node.type.name === 'questionStem') matchedContent = true;
    if (
      target !== 'stem'
      && node.type.name === 'questionOption'
      && node.attrs.option_id === target.optionId
    ) {
      matchedContent = true;
    }
  }
  return matchedQuestion && matchedContent;
}

export function resolveQuestionDropPosition(
  document: ProseMirrorNode,
  geometry: QuestionDropGeometry,
  point: DropPoint,
  mappedPosition: number | null,
): number | null {
  if (!contains(geometry.canvas, point)) return null;
  if (document.childCount === 0) return geometry.questions.length === 0 ? 0 : null;

  const questions = positionedQuestions(document, geometry);
  if (!questions?.length) return null;

  for (const question of questions) {
    if (point.y < question.rect.top) return question.position;
    if (point.y > question.rect.bottom) continue;
    if (point.x < question.rect.left || point.x > question.rect.right) return null;

    let target: 'stem' | { optionId: string } | null = null;
    if (question.stem && contains(question.stem, point)) target = 'stem';
    if (!target) {
      const option = question.options.find((candidate) => contains(candidate.rect, point));
      if (option) target = { optionId: option.optionId };
    }
    if (!target) return question.position + 1;
    if (
      mappedPosition !== null
      && mappedPositionMatches(document, mappedPosition, question.clientId, target)
    ) {
      return mappedPosition;
    }
    return contentPosition(question, target);
  }

  return document.content.size;
}

function rectFromElement(element: Element): DropRect {
  const rect = element.getBoundingClientRect();
  return {
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
  };
}

export function collectQuestionDropGeometry(canvas: HTMLElement): QuestionDropGeometry {
  const questions = [...canvas.querySelectorAll<HTMLElement>('[data-question-block][data-client-id]')]
    .map((block) => ({
      clientId: block.dataset.clientId ?? '',
      rect: rectFromElement(block),
      stem: block.querySelector<HTMLElement>('[data-question-stem]')
        ? rectFromElement(block.querySelector<HTMLElement>('[data-question-stem]')!)
        : undefined,
      options: [...block.querySelectorAll<HTMLElement>('[data-question-option][data-option-id]')]
        .map((option) => ({
          optionId: option.dataset.optionId ?? '',
          rect: rectFromElement(option),
        }))
        .filter((option) => option.optionId),
    }))
    .filter((question) => question.clientId);

  return {
    canvas: rectFromElement(canvas),
    questions,
  };
}
