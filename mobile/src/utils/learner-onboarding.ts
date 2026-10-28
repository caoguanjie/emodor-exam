interface LearnerBasics { real_name: string; category_id: string | number | null }

export function needsLearnerProfile(profile: LearnerBasics): boolean {
  return !profile.real_name.trim()
}

export function learnerLandingUrl(profile: LearnerBasics): string {
  return needsLearnerProfile(profile) ? '/pages/profile/info?onboarding=1' : '/pages/home/index'
}

export function identityNeedsProfile(status: string, profile: LearnerBasics): boolean {
  return status !== 'pending' && status !== 'verified' && needsLearnerProfile(profile)
}
