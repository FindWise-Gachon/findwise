export const abmBehaviorLabels = {
  rw: '무작위 보행',
  rt: '경로 따라가기',
  dt: '방향 유지',
  sp: '제자리에 머무르기',
  ve: '높은 곳으로 이동',
  bt: '되돌아가기',
} as const

export type AbmBehavior = keyof typeof abmBehaviorLabels

export function isAbmBehavior(value: unknown): value is AbmBehavior {
  return typeof value === 'string' && Object.hasOwn(abmBehaviorLabels, value)
}
