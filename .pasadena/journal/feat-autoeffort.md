---
branch: feat/autoeffort
spec: docs/sdd/specs/2026-10-08-autoeffort.md
plan: docs/sdd/plans/2026-10-08-autoeffort.md
status: in-progress
started: 2026-10-08
---

## Goal
Мод autoeffort для Claude Code: хук turn.step виставляє effort для кожного запиту до моделі за фазою роботи (збір контексту, планування, реалізація, перевірка) і поєднує його з effort зі скілів.
Готово, коли мод завантажується, проходить validate і тести класифікації, а поточний рівень і причина видні в статус-рядку.

## Now
1. Building (wolowitz): план docs/sdd/plans/2026-10-08-autoeffort.md схвалено, 7 задач у 5 хвилях (1 → 2,3,4 → 5 → 6 → 7).
2. Збірка й тести йдуть у копії в контейнері /home/claude/autoeffort (на комп'ютері claude працює лише як -p); після кожної хвилі файли переносяться сюди і комітяться.
3. Далі: хвиля 1 — Task 1 (каркас, src/levels.ts, контракт стану); перевірка `claude plugin test /home/claude/autoeffort`.

## Timeline
### 2026-10-08
- ✎ Репо ініціалізовано, гілка feat/autoeffort; класифікація — architectural; рівень low виключено, збір контексту на medium.
- 14:05 ▶ start · feat/autoeffort @ 72ee22c
- 14:06 ⏸ pause · exit · HEAD=af657a4
  ↳ 1. Shaping (sheldon), архітектурний шлях. Узгоджено: збір контексту → medium, планування → xhigh, реалізація → medium, перевірка → xhigh; low не використовується. 2. Відкрите питання: як effort зі скі
- ✎ Дизайн узгоджено: A + C (маркери ⟦phase:…⟧ через prompt.compose + правила за інструментами), скіл = нижня межа, субагенти теж під модом; правило переходу до plan — ≥ 3 кроки поспіль лише з читаннями.
- ✎ План схвалено: 7 задач, 5 хвиль; історію інструментів беремо з toolUses у результаті turn.step (без окремого tool.call); межа субагента — через відхилення e.effort від baseline.
