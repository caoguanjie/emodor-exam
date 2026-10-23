import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { ApiError } from '@/api/client'
import { getCourse, getCourseProgress, getCourses, getLearnerHome, type CourseDetail, type CourseLessonProgress, type CourseSummary, type Page, type PublicSiteConfig } from '@/api/courses'
import type { VideoProgress } from '@/api/video'
import { useSessionStore } from './session'

function emptyPage(pageSize: number): Page<CourseSummary> { return { items: [], total: 0, page: 0, page_size: pageSize } }
function message(error: unknown): string { return error instanceof Error ? error.message : '课程加载失败，请重试' }

export const useCourseStore = defineStore('mobile-course', () => {
  const session = useSessionStore()
  const home = ref(emptyPage(4))
  const siteConfig = ref<PublicSiteConfig>({ logo_asset_id: null, banners: [] })
  const list = ref(emptyPage(10))
  const detail = ref<CourseDetail | null>(null)
  const progressPercent = ref<Record<string, number | null>>({})
  const progressComplete = ref<Record<string, boolean>>({})
  const lessonProgress = ref<Record<string, Record<string, CourseLessonProgress>>>({})
  const homeLoading = ref(false), listLoading = ref(false), detailLoading = ref(false)
  const homeError = ref(''), listError = ref(''), detailError = ref('')
  const hasMore = computed(() => list.value.items.length < list.value.total)
  let homeRequest = 0, listRequest = 0, detailRequest = 0
  const progressRequests = new Map<string, number>()
  let lessonRevisions: Record<string, Record<string, number>> = {}
  const chapters = computed(() => (detail.value?.chapters || []).map(chapter => ({ id: chapter.id, title: chapter.title, lessons: chapter.lessons.map(lesson => {
    const saved = lessonProgress.value[detail.value!.id]?.[lesson.id]
    const progress = saved?.version_id === lesson.current_version?.version_id ? saved : undefined
    const seconds = Math.floor((progress?.confirmed_position_ms || 0) / 1000)
    const position = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
    return { id: lesson.id, title: lesson.title, completed: progress?.completed === true, progressText: progress ? progress.completed ? '已完成' : seconds > 0 ? `已学 ${position}` : '未开始' : '视频' }
  }) })))

  watch(() => session.sessionEpoch, () => {
    homeRequest++; listRequest++; detailRequest++
    home.value = emptyPage(4); list.value = emptyPage(10); detail.value = null
    siteConfig.value = { logo_asset_id: null, banners: [] }; progressPercent.value = {}; progressComplete.value = {}
    lessonProgress.value = {}; progressRequests.clear(); lessonRevisions = {}
    homeLoading.value = false; listLoading.value = false; detailLoading.value = false
    homeError.value = ''; listError.value = ''; detailError.value = ''
  }, { flush: 'sync' })

  async function ready() {
    if (!session.initialized && !await session.bootstrap()) throw new ApiError(40107, '请先登录')
    if (!session.accessToken) throw new ApiError(40107, '请先登录')
  }

  async function loadProgress(ids: string[]) {
    const epoch = session.sessionEpoch
    await Promise.all(ids.map(async id => {
      const current = (progressRequests.get(id) || 0) + 1
      progressRequests.set(id, current)
      const startedLessons = { ...lessonRevisions[id] }
      try {
        const progress = await getCourseProgress(id)
        if (epoch === session.sessionEpoch && progressRequests.get(id) === current) {
          progressPercent.value[id] = progress.completion_rate === null ? 0 : Math.round(progress.completion_rate * 100)
          progressComplete.value[id] = progress.completion_rate === 1
          const lessons = { ...lessonProgress.value[id] }
          for (const item of progress.lessons) {
            if (typeof item.lesson_id !== 'string' || !/^[1-9]\d*$/.test(item.lesson_id) || typeof item.version_id !== 'string' || !/^[1-9]\d*$/.test(item.version_id)) continue
            if ((lessonRevisions[id]?.[item.lesson_id] || 0) === (startedLessons[item.lesson_id] || 0)) lessons[item.lesson_id] = item
          }
          lessonProgress.value[id] = lessons
        }
      } catch { if (epoch === session.sessionEpoch && progressRequests.get(id) === current) { progressPercent.value[id] = null; progressComplete.value[id] = false } }
    }))
  }

  function acceptLessonProgress(courseId: string, lessonId: string, versionId: string, progress: VideoProgress) {
    const revisions = lessonRevisions[courseId] ||= {}
    revisions[lessonId] = (revisions[lessonId] || 0) + 1
    lessonProgress.value[courseId] = { ...lessonProgress.value[courseId], [lessonId]: { ...progress, lesson_id: lessonId, version_id: versionId } }
  }

  async function loadHome() {
    const current = ++homeRequest
    homeLoading.value = true; homeError.value = ''
    try {
      await ready()
      const result = await getLearnerHome()
      if (current !== homeRequest) return
      siteConfig.value = result.site_config; home.value = result.courses
      await loadProgress(result.courses.items.map(item => item.id))
    } catch (error) { if (current === homeRequest) homeError.value = message(error); throw error }
    finally { if (current === homeRequest) homeLoading.value = false }
  }

  async function loadList(page = 1) {
    if (listLoading.value) return
    const current = ++listRequest
    listLoading.value = true; listError.value = ''
    try {
      await ready()
      const result = await getCourses(page, list.value.page_size)
      if (current !== listRequest) return
      const items = page === 1 ? result.items : [...list.value.items, ...result.items.filter(item => !list.value.items.some(existing => existing.id === item.id))]
      list.value = { ...result, items }
      await loadProgress(result.items.map(item => item.id))
    } catch (error) { if (current === listRequest) listError.value = message(error); throw error }
    finally { if (current === listRequest) listLoading.value = false }
  }
  function loadMore() { return hasMore.value ? loadList(list.value.page + 1) : Promise.resolve() }

  async function loadDetail(id: string) {
    const current = ++detailRequest
    detail.value = null; detailLoading.value = true; detailError.value = ''
    try {
      await ready()
      const result = await getCourse(id)
      if (current !== detailRequest) return
      detail.value = result
      await loadProgress([id])
    } catch (error) { if (current === detailRequest) detailError.value = message(error); throw error }
    finally { if (current === detailRequest) detailLoading.value = false }
  }
  return { home, siteConfig, list, detail, chapters, lessonProgress, progressPercent, progressComplete, homeLoading, listLoading, detailLoading, homeError, listError, detailError, hasMore, loadHome, loadList, loadMore, loadDetail, loadProgress, acceptLessonProgress }
})
