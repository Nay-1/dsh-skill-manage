import { SkillManageSection } from './section'
import type { ClientCtx } from './types'

/** Services required on the fiber before apply runs. */
export const inject = ['slots']

export function apply(ctx: ClientCtx): void {
  const slots = ctx.slots
  slots.inject('settings.section', () =>
    slots.register(
      {
        name: 'settings.section',
        id: 'skill-manage',
        order: 60,
        label: () => '技能管理',
        inject: () => ({}),
      },
      SkillManageSection,
    ),
  )
}
