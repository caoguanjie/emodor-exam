import { ApiError, request } from './client'
import type { MobileSessionResult, SmsChallenge, SmsLoginInput } from '@/types/api'
import type { Page } from './courses'
export function normalizeMobilePhone(phone: string): string { return phone.replace(/[\s-]/g, '') }
export function isValidMobilePhone(phone: string): boolean { return /^1[3-9]\d{9}$/.test(normalizeMobilePhone(phone)) }

export async function sendSmsCode(phone: string): Promise<SmsChallenge> {
  if (!isValidMobilePhone(phone)) throw new ApiError(40001, '请输入正确的11位手机号')
  return request({ url: '/mobile/auth/sms/send', method: 'POST', data: { phone: normalizeMobilePhone(phone) }, auth: false })
}

export async function loginWithSms(data: SmsLoginInput): Promise<MobileSessionResult> {
  if (!isValidMobilePhone(data.phone) || !data.challenge_id || !/^\d{6}$/.test(data.code)) throw new ApiError(40001, '请填写手机号并输入6位验证码')
  return request({ url: '/mobile/auth/sms/login', method: 'POST', data: { ...data, phone: normalizeMobilePhone(data.phone) }, auth: false })
}

export function refreshMobileSession(): Promise<MobileSessionResult> {
  return request({ url: '/mobile/auth/refresh', method: 'POST', auth: false })
}

export function logoutMobileSession(accessToken?: string): Promise<null> {
  return request({ url: '/mobile/auth/logout', method: 'POST', auth: false, refreshOnUnauthorized: false, headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined })
}

export interface LearnerProfile {
  id: string
  username: string
  real_name: string
  phone: string | null
  email: string | null
  avatar_id: string | null
  occupation: string | null
  gender: 'male' | 'female' | null
  birthday: string | null
  source: 'institution' | 'external' | null
  category_id: string | null
  category_name: string | null
  role: 'employee' | 'regulation_admin' | 'super_admin'
  status: number
}
export interface EditableLearnerProfile { occupation?: string | null; gender?: 'male' | 'female' | null; birthday?: string | null; avatar_id?: string | null }
export function getLearnerProfile(): Promise<LearnerProfile> { return request({ url: '/me/profile' }) }
export function saveLearnerProfile(data: EditableLearnerProfile): Promise<LearnerProfile> {
  return request({ url: '/me/profile', method: 'POST', data })
}
export interface LearnerTrainingCategory { id: string; name: string }
export function getLearnerTrainingCategories(page = 1): Promise<Page<LearnerTrainingCategory>> {
  return request({ url: `/me/training-categories?page=${page}&page_size=100` })
}
export function confirmLearnerTrainingCategory(category_id: string): Promise<LearnerProfile> {
  if (!/^[1-9]\d*$/.test(category_id)) throw new ApiError(40001, '请选择有效培训工种')
  return request({ url: '/me/training-category', method: 'PUT', data: { category_id }, refreshOnUnauthorized: false })
}
