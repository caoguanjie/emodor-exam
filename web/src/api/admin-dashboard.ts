import http from './http';
import type {
  AdminDashboard, DashboardExamTrend, DashboardLearningOptions,
  DashboardLearningSummary, DashboardRecentExams,
} from './training-types';

export function getDashboard(signal?: AbortSignal): Promise<AdminDashboard> {
  return http.get<never, AdminDashboard>('/admin/dashboard', { signal });
}

export function getDashboardTrend(days: 7 | 30, signal?: AbortSignal): Promise<DashboardExamTrend> {
  return http.get<never, DashboardExamTrend>('/admin/dashboard/exam-trend', { params: { days }, signal });
}

export function getDashboardLearningOptions(
  query: { keyword?: string; page?: number; page_size?: number }, signal?: AbortSignal,
): Promise<DashboardLearningOptions> {
  return http.get<never, DashboardLearningOptions>('/admin/dashboard/learning-options', { params: query, signal });
}

export function getDashboardLearningSummary(paperId: string, releaseId: string, signal?: AbortSignal): Promise<DashboardLearningSummary> {
  return http.get<never, DashboardLearningSummary>('/admin/dashboard/learning-summary', {
    params: { paper_id: paperId, release_id: releaseId }, signal,
  });
}

export function getDashboardRecentExams(signal?: AbortSignal): Promise<DashboardRecentExams> {
  return http.get<never, DashboardRecentExams>('/admin/dashboard/recent-exams', { signal });
}
