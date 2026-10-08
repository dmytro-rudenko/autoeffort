import type { Register } from 'claude-code'

// Заглушка: справжня реєстрація хуків з'явиться в задачі 6.
export const register: Register = on => {
  on('session.start', ($, e, next) => next(e))
}
