import { request } from './client'
import type { VideoProgress } from './video'
import type { SiteAbout } from './site-config'

export interface Page<T> { items: T[]; total: number; page: number; page_size: number }
export interface PublicSiteConfig { logo_asset_id: string | null; banners: { asset_id: string; sort: number }[]; about?: SiteAbout }
export interface CourseSummary { id: string; title: string; category_id: string; cover_asset_id: string | null; status: 'published'; required_lesson_count: number }
export interface CourseLessonVersion { version_id: string; asset_id: string; duration_ms: number }
export interface CourseLesson { id: string; title: string; lesson_type: 'video'; required: boolean; sort_order: number; current_version: CourseLessonVersion | null }
export interface CourseChapter { id: string; title: string; sort_order: number; lessons: CourseLesson[] }
export interface CourseDetail extends CourseSummary { description: string | null; chapters: CourseChapter[] }
export interface CourseLessonProgress extends VideoProgress { lesson_id: string; version_id: string }
export interface CourseProgress { required: number; completed: number; completion_rate: number | null; lessons: CourseLessonProgress[] }
export interface LearnerHome { site_config: PublicSiteConfig; courses: Page<CourseSummary> }

export function getLearnerHome(page = 1, pageSize = 4): Promise<LearnerHome> {
  return request({ url: `/me/home?page=${page}&page_size=${pageSize}` })
}
export function getCourses(page = 1, pageSize = 10): Promise<Page<CourseSummary>> {
  return request({ url: `/me/courses?page=${page}&page_size=${pageSize}` })
}
export function getCourse(id: string): Promise<CourseDetail> { return request({ url: `/me/courses/${encodeURIComponent(id)}` }) }
export function getCourseProgress(id: string): Promise<CourseProgress> { return request({ url: `/me/courses/${encodeURIComponent(id)}/progress` }) }
