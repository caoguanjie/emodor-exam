import http from './http';
import type { AssembleInput, AuthoringBundle, AuthoringCommitRequest, AuthoringReceipt, ConceptSummary } from './question-document-types';
import type { Id, Page, QuestionType } from './training-types';

export interface QuestionConceptQuery {
  category_id: Id;
  type?: QuestionType;
  query?: string;
  page: number;
  page_size: number;
}
export interface QuestionConceptInput { category_id: Id; name: string; description: string; type: QuestionType }
export interface QuestionConceptAccess { read: boolean; create: boolean; edit: boolean; delete: boolean }
/** UI injection contract. The host supplies only actions supported by main and its permissions. */
export interface QuestionConceptApi {
  list(query: QuestionConceptQuery): Promise<Page<ConceptSummary>>;
  create(input: QuestionConceptInput): Promise<ConceptSummary>;
  update(id: Id, input: QuestionConceptInput): Promise<ConceptSummary>;
  remove(id: Id): Promise<void>;
}
export type QuestionConceptOptionsApi = (query: QuestionConceptQuery & { type: QuestionType }) => Promise<Page<Pick<ConceptSummary, 'id' | 'name'>>>;

export const questionAuthoringApi = {
  assemble(input: AssembleInput): Promise<AuthoringBundle> {
    return http.post('/admin/question-documents/assemble', input) as Promise<AuthoringBundle>;
  },
  commit(input: AuthoringCommitRequest): Promise<AuthoringReceipt> {
    return http.post('/admin/question-documents/commit', input) as Promise<AuthoringReceipt>;
  },
  getCommit(requestId: string): Promise<AuthoringReceipt> {
    return http.get(`/admin/question-documents/commits/${encodeURIComponent(requestId)}`) as Promise<AuthoringReceipt>;
  },
};

export interface DifficultyOption { code: string; label: string; enabled: boolean; sort: number }
export interface AuthoringOptions { difficulties: DifficultyOption[] }
export function getAuthoringOptions(): Promise<AuthoringOptions> {
  return http.get('/admin/questions/authoring-options') as Promise<AuthoringOptions>;
}
