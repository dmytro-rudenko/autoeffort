# autoeffort — implementation plan

**Goal:** мод Claude Code `autoeffort`, що на кожен запит до моделі (`turn.step`) виставляє effort за фазою роботи (маркер `⟦phase:…⟧` від моделі, інакше правила за інструментами), поєднує його з effort скіла чи субагента як нижньою межею, ніколи не опускається нижче `medium` і показує рішення в статус-рядку, команді `/autoeffort` і лозі.
**Spec:** docs/sdd/specs/2026-10-08-autoeffort.md
**Verification:** у робочій копії `/home/claude/autoeffort`:
`claude plugin validate /home/claude/autoeffort` → останній рядок `√ Validation passed`;
`claude plugin test /home/claude/autoeffort` → усі тести пройшли, 0 failed;
`tsc -p /home/claude/autoeffort` → без виводу, код 0.

## Context
Стандартний `auto` effort непрозорий і не розрізняє етапи роботи. Мод реалізує схвалену специфікацію (A + C): маркер фази має пріоритет над правилами, скіл чи агент задає нижню межу, `low` не використовується.

## Waves
| Wave | Tasks | Why together |
|---|---|---|
| 1 | 1 | alone — каркас, `levels.ts`, контракт стану; від нього залежить усе |
| 2 | 2, 3, 4 | disjoint: `src/classify*` vs `src/marker*` vs `src/config*` |
| 3 | 5 | `decide` споживає `classify` (2) і `config` (4) |
| 4 | 6 | `hooks/register.ts` споживає `marker` (3) і `decide` (5) |
| 5 | 7 | теж пише `hooks/register.ts` (команда, README) — серіалізовано після 6 |

Серіалізовано: задачі 6 і 7 обидві пишуть `hooks/register.ts`, тому це дві хвилі.

## Global constraints
- **Де працюємо.** Джерело правди — репо на комп'ютері користувача `/home/pc/projects/my-cc-mods/autoeffort` (у device_bash — `$HOME/mnt/autoeffort`), гілка `feat/autoeffort`. На комп'ютері `claude` працює лише як `claude -p`, тому збірка й перевірка йдуть у робочій копії контейнера `/home/claude/autoeffort` (Claude Code 2.1.294: `claude plugin validate|test`, `tsc`). Перед хвилею 1 оркестратор (wolowitz) створює копію (stage файлів репо). Після кожної хвилі він переносить файли з `Writes` задач хвилі на комп'ютер через `device_commit_files` і комітить там через `device_bash` (`git add <files> && git commit -m "<type>(autoeffort): <task>"`). Субагенти пишуть лише в `/home/claude/autoeffort`.
- **Типи для tsc.** Перед `tsc` скопіювати `/tmp/claude-0/bundled-skills/2.1.294/561b3a20ec9877d96ac7acf05fa1a7b9/plugin-authoring/types/claude-code.d.ts` у `/home/claude/autoeffort/.claude-plugin/types/claude-code/index.d.ts` (каталог `.claude-plugin/types/` у `.gitignore`; рушій сам кладе туди типи при завантаженні). Довідник API — цей самий файл: шукати `'turn.step'`, `TurnStepInput`, `PromptComposeSection`, `CommandSpec` тощо.
- **Середовище модуля:** ES-модулі, без Node і DOM, без `import()`. Імпорт між файлами плагіна — звичайним `import`; написання шляху (з `.ts` чи без) фіксує задача 1 у `tests/levels.test.ts`, далі всі задачі пишуть так само.
- **Тести:** `tests/*.test.ts`, імпорт `test`, `expect` з `'claude-code/testing'`; запуск `claude plugin test /home/claude/autoeffort`. Кожна задача: тест → бачимо падіння → мінімальна реалізація → бачимо проходження.
- **Рівні:** лише `medium`, `high`, `xhigh`, `max`; вхідний `low` → `medium`. Типові: gather→medium, plan→xhigh, implement→medium, verify→xhigh.
- **Маркер:** `⟦phase:gather|plan|implement|verify⟧` (символи U+27E6 / U+27E7). Діє на один наступний крок свого треду.
- **Тред:** ключ `e.agentId ?? 'main'`.
- **Fail-open:** будь-яка помилка в логіці мода → запит іде з незміненим `e`, помилка в `$.ui.log`.
- Ім'я плагіна і ключ стану: `autoeffort`. Ідентифікатор секції промпту: `autoeffort:phase-marker`.
- Мова коментарів і README — українська; ідентифікатори — англійською.

---

### Task 1: каркас плагіна, `levels.ts`, контракт стану

**Writes:** `.claude-plugin/plugin.json`, `hooks/hooks.json`, `hooks/register.ts`, `types/index.d.ts`, `tsconfig.json`, `.gitignore`, `src/levels.ts`, `tests/levels.test.ts`
**Reads:** spec §3.1, §3.5, §3.6
**Depends on:** —
**Interfaces:**
- Produces: `src/levels.ts` — `type Level = 'medium'|'high'|'xhigh'|'max'`, `type AnyLevel = 'low'|Level`, `LEVELS: readonly Level[]`, `isLevel(x: unknown): x is AnyLevel`, `rank(l: AnyLevel): number` (low 0 … max 4), `applyFloor(l: AnyLevel): Level`, `maxLevel(a: AnyLevel, b: AnyLevel): Level` (з підлогою).
- Produces: `types/index.d.ts` — контракт `$.state`:
  ```ts
  export type AutoeffortStep = { tools: { name: string; command?: string }[] }
  export type AutoeffortThread = {
    steps: AutoeffortStep[]        // останні ≤ 10 кроків
    readStreak: number
    editedThisTurn: boolean
    lastPhase?: 'gather' | 'plan' | 'implement' | 'verify'
    marker?: 'gather' | 'plan' | 'implement' | 'verify'
  }
  export type AutoeffortLogEntry = {
    at: number; thread: string; step: number; incoming?: string
    level: string; phase: string; source: string; floor?: string
  }
  declare module 'claude-code' {
    interface PluginState {
      autoeffort: {
        threads: Record<string, AutoeffortThread>
        log: AutoeffortLogEntry[]
        enabled: boolean
        baseline: string | null
        skill: string | null
      }
    }
  }
  ```
- Produces: `plugin.json` з `userConfig` (див. крок 3), `"types": "./types/index.d.ts"`.

- [x] **Step 1: тест** — `tests/levels.test.ts`:
  ```ts
  import { test, expect } from 'claude-code/testing'
  import { applyFloor, maxLevel, isLevel, rank } from '../src/levels'
  test('low піднімається до medium', () => { expect(applyFloor('low')).toBe('medium') })
  test('maxLevel бере вищий', () => {
    expect(maxLevel('medium', 'xhigh')).toBe('xhigh')
    expect(maxLevel('max', 'high')).toBe('max')
    expect(maxLevel('low', 'low')).toBe('medium')
  })
  test('isLevel', () => { expect(isLevel('xhigh')).toBe(true); expect(isLevel('auto')).toBe(false); expect(isLevel(3)).toBe(false) })
  test('rank', () => { expect(rank('low')).toBe(0); expect(rank('max')).toBe(4) })
  ```
- [x] **Step 2: каркас без levels, бачимо падіння.**
  `.claude-plugin/plugin.json`:
  ```json
  {
    "name": "autoeffort",
    "version": "0.1.0",
    "description": "Effort за фазами роботи: збір контексту, планування, реалізація, перевірка",
    "author": { "name": "Dmitry Rudenko" },
    "types": "./types/index.d.ts",
    "userConfig": {
      "enabled":       { "type": "boolean", "title": "Увімкнено", "description": "Чи керує мод effort", "default": true },
      "gather":        { "type": "string", "title": "Збір контексту", "description": "Рівень для фази gather", "default": "medium", "options": ["medium","high","xhigh","max"] },
      "plan":          { "type": "string", "title": "Планування", "description": "Рівень для фази plan", "default": "xhigh", "options": ["medium","high","xhigh","max"] },
      "implement":     { "type": "string", "title": "Реалізація", "description": "Рівень для фази implement", "default": "medium", "options": ["medium","high","xhigh","max"] },
      "verify":        { "type": "string", "title": "Перевірка", "description": "Рівень для фази verify", "default": "xhigh", "options": ["medium","high","xhigh","max"] },
      "readStreak":    { "type": "number", "title": "Поріг серії читань", "description": "Скільки кроків поспіль лише з читаннями переводять у plan", "default": 3 },
      "verifyPattern": { "type": "string", "title": "Патерн команд перевірки", "description": "RegExp для Bash-команд фази verify", "default": "\\b(test|tests|jest|vitest|pytest|lint|eslint|tsc|build|typecheck|cargo (check|test)|go test)\\b" }
    }
  }
  ```
  `hooks/hooks.json`: `{ "modules": ["./register.ts"] }`.
  `hooks/register.ts` (заглушка): `import type { Register } from 'claude-code'` + `export const register: Register = on => { on('session.start', ($, e, next) => next(e)) }`.
  `types/index.d.ts` — як в Interfaces.
  `tsconfig.json` — опції з заголовка файлу типів (`target es2023`, `lib ["es2023"]`, `types []`, `module esnext`, `moduleResolution bundler`, `strict`, `noUncheckedIndexedAccess`, `noEmit`, `skipLibCheck`, `jsx react`, `jsxFactory h`, `jsxFragmentFactory Fragment`), `"include": [".claude-plugin/types", "hooks", "types", "src", "tests"]`.
  `.gitignore`: `.claude-plugin/types/`, `node_modules/`.
  Запуск `claude plugin test /home/claude/autoeffort` → тест падає на відсутньому `../src/levels`.
- [x] **Step 3: реалізація** `src/levels.ts`:
  ```ts
  export type Level = 'medium' | 'high' | 'xhigh' | 'max'
  export type AnyLevel = 'low' | Level
  export const LEVELS: readonly Level[] = ['medium', 'high', 'xhigh', 'max']
  const RANK: Record<AnyLevel, number> = { low: 0, medium: 1, high: 2, xhigh: 3, max: 4 }
  export const isLevel = (x: unknown): x is AnyLevel => typeof x === 'string' && x in RANK
  export const rank = (l: AnyLevel): number => RANK[l]
  export const applyFloor = (l: AnyLevel): Level => (l === 'low' ? 'medium' : l)
  export const maxLevel = (a: AnyLevel, b: AnyLevel): Level => applyFloor(RANK[a] >= RANK[b] ? a : b)
  ```
- [x] **Step 4: проходження** — `claude plugin test` → 4 passed. Якщо імпорт без `.ts` не резолвиться, перейти на `'../src/levels.ts'` і додати `"allowImportingTsExtensions": true` у `tsconfig.json`; обране написання лишається в `tests/levels.test.ts` як зразок. Далі `claude plugin validate /home/claude/autoeffort` → `√ Validation passed`, `tsc -p /home/claude/autoeffort` → чисто.

---

### Task 2: `classify.ts` — правила фаз

**Writes:** `src/classify.ts`, `tests/classify.test.ts`
**Reads:** `src/levels.ts`, `tests/levels.test.ts` (написання імпорту), `types/index.d.ts`
**Depends on:** Task 1
**Interfaces:**
- Produces:
  ```ts
  export type Phase = 'gather' | 'plan' | 'implement' | 'verify'
  export const PHASES: readonly Phase[]
  export const isPhase: (x: unknown) => x is Phase
  export type ToolUse = { name: string; command?: string }
  export type History = { steps: readonly { tools: readonly ToolUse[] }[]; readStreak: number; editedThisTurn: boolean; lastPhase?: Phase }
  export const EMPTY_HISTORY: History   // { steps: [], readStreak: 0, editedThisTurn: false }
  export type ClassifyCtx = { stepIndex: number; readStreak: number; verifyPattern: RegExp }
  export function classify(h: History, ctx: ClassifyCtx): { phase: Phase; rule: string }
  export function recordStep(h: History, tools: readonly ToolUse[], opts: { resetStreak: boolean }): History
  export function startTurn(h: History): History   // editedThisTurn=false, readStreak=0, steps лишаються
  ```
  `History` структурно сумісний з `AutoeffortThread` з контракту (без `marker`).

Правила `classify`, у цьому порядку (перше, що спрацювало):
1. `ctx.stepIndex === 0` → `{ phase: 'plan', rule: 'first-step' }`
2. `last = h.steps.at(-1)?.tools ?? []`; якщо `last` порожній → крок 7.
3. є `Bash` з `command`, що матчить `ctx.verifyPattern`, і `h.editedThisTurn` → `verify`, `'verify-command'`
4. є будь-який з `EDIT = ['Edit','Write','NotebookEdit','MultiEdit']` → `implement`, `'edit'`
5. усі виклики з `READ = ['Read','Grep','Glob','LS','WebFetch','WebSearch']` і `h.readStreak >= ctx.readStreak` → `plan`, `'read-streak'`
6. усі виклики з `READ` → `gather`, `'read'`
7. інакше → `{ phase: h.lastPhase ?? 'plan', rule: 'carry' }`

(Verify стоїть перед edit: якщо крок і редагував, і запускав тести, наступний крок розбирає результати перевірки.)

`recordStep`: `steps = [...h.steps, { tools }].slice(-10)`; `editedThisTurn ||= tools.some(EDIT)`; `readStreak = opts.resetStreak ? 0 : h.readStreak`; потім якщо `tools.length > 0 && tools.every(READ)` → `readStreak + 1`, інакше `0`.

- [ ] **Step 1: тест** `tests/classify.test.ts` — по одному тесту на кожне правило 1–7 і на `recordStep`:
  - `stepIndex 0` → plan/first-step навіть після Edit;
  - Bash `npm test` після редагування → verify; той самий Bash без `editedThisTurn` → carry;
  - Edit → implement; Edit + Bash `vitest` при editedThisTurn → verify;
  - Read при readStreak 3 (поріг 3) → plan/read-streak; Read при readStreak 1 → gather/read;
  - Read + Bash `ls` → carry з `lastPhase: 'implement'` → implement; порожня історія на кроці 2 → plan/carry;
  - `recordStep` нарощує streak на кроках лише з читанням, скидає на змішаному, `resetStreak` обнуляє перед підрахунком, `steps` обрізаються до 10;
  - `startTurn` скидає `editedThisTurn` і `readStreak`.
  Регекс у тестах: `new RegExp('\\b(test|tests|jest|vitest|pytest|lint|eslint|tsc|build|typecheck|cargo (check|test)|go test)\\b')`.
- [ ] **Step 2:** `claude plugin test` → classify-тести падають (модуля немає).
- [ ] **Step 3:** реалізувати `src/classify.ts` за правилами вище.
- [ ] **Step 4:** `claude plugin test` → усі зелені; `tsc -p` → чисто.

---

### Task 3: `marker.ts` — потоковий фільтр маркера

**Writes:** `src/marker.ts`, `tests/marker.test.ts`
**Reads:** `tests/levels.test.ts` (написання імпорту)
**Depends on:** Task 1
**Interfaces:**
- Produces:
  ```ts
  export type MarkerFilter = {
    push(text: string): string     // повертає текст, який безпечно показати зараз
    flush(): string                // віддає утримане (незавершений «хвіст», що не став маркером)
    readonly phase: 'gather' | 'plan' | 'implement' | 'verify' | undefined  // останній валідний маркер
  }
  export function createMarkerFilter(): MarkerFilter
  export function stripMarkers(text: string): string   // для result.answer
  ```
Поведінка:
- Повний маркер: `/⟦phase:([^⟧\n]{0,24})⟧[ \t]*\n?/g` — вирізається разом з одним наступним переносом рядка. Валідне значення (`gather|plan|implement|verify`) записується в `phase` (виграє останній), невалідне просто вирізається.
- Утримання: після вирізання, якщо в буфері є `⟦` без `⟧` після нього, хвіст від `⟦` коротший за 32 символи і він є префіксом `⟦phase:` або починається з `⟦phase:`, цей хвіст утримується до наступного `push`. Решта віддається.
- `flush()` віддає утримане як є і очищає буфер.

- [ ] **Step 1: тест** `tests/marker.test.ts`:
  - `push('⟦phase:plan⟧\nДалі читаю')` → `'Далі читаю'`, `phase === 'plan'`;
  - маркер розірвано на 3 шматки: `'Ок ⟦pha'`, `'se:impl'`, `'ement⟧ go'` → разом віддано `'Ок '` + `'go'`, `phase === 'implement'`;
  - `'⟦phase:bogus⟧x'` → `'x'`, `phase === undefined`;
  - текст без маркера проходить без змін, зокрема з символом `⟦` поза маркером: `'a ⟦b⟧ c'` → `'a ⟦b⟧ c'` (утримання лише для префікса `⟦phase:`);
  - `push('кінець ⟦ph')` → `'кінець '`, потім `flush()` → `'⟦ph'`;
  - два маркери → `phase` — другий;
  - `stripMarkers('⟦phase:verify⟧\nok')` → `'ok'`.
- [ ] **Step 2:** `claude plugin test` → падає.
- [ ] **Step 3:** реалізувати `src/marker.ts`.
- [ ] **Step 4:** `claude plugin test` → зелені; `tsc -p` → чисто.

---

### Task 4: `config.ts` — налаштування з `userConfig`

**Writes:** `src/config.ts`, `tests/config.test.ts`
**Reads:** `src/levels.ts`, `.claude-plugin/plugin.json`, `tests/levels.test.ts`
**Depends on:** Task 1
**Interfaces:**
- Consumes: `Level`, `isLevel`, `applyFloor` (Task 1).
- Produces:
  ```ts
  export type PhaseName = 'gather' | 'plan' | 'implement' | 'verify'
  export type Config = { enabled: boolean; levels: Record<PhaseName, Level>; readStreak: number; verifyPattern: RegExp }
  export const DEFAULT_VERIFY_PATTERN = '\\b(test|tests|jest|vitest|pytest|lint|eslint|tsc|build|typecheck|cargo (check|test)|go test)\\b'
  export const DEFAULTS: Config   // enabled true; medium/xhigh/medium/xhigh; readStreak 3; RegExp(DEFAULT_VERIFY_PATTERN)
  export function loadConfig(options: Readonly<Record<string, unknown>>): Config
  ```
  (`PhaseName` дублює `Phase` з Task 2, щоб хвиля 2 була незалежною; вони структурно однакові.)
Правила: невалідний рівень (або `low`) → значення з `DEFAULTS` (для `low` — `applyFloor`, тобто `medium`); `readStreak` — ціле ≥ 1, інакше 3; некоректний RegExp → `DEFAULT_VERIFY_PATTERN`; `enabled` не boolean → true.

- [ ] **Step 1: тест** `tests/config.test.ts`: порожні options → `DEFAULTS`; `{ plan: 'max' }` → plan max; `{ gather: 'low' }` → medium; `{ gather: 'turbo' }` → medium (типове); `{ readStreak: 0 }` → 3; `{ verifyPattern: '(' }` → типовий регекс (`.source === DEFAULT_VERIFY_PATTERN`); `{ enabled: false }` → false.
- [ ] **Step 2:** падає. **Step 3:** реалізація. **Step 4:** зелені; `tsc -p` → чисто.

---

### Task 5: `decide.ts` — поєднання фази, маркера, межі, підлоги

**Writes:** `src/decide.ts`, `tests/decide.test.ts`
**Reads:** `src/levels.ts`, `src/classify.ts`, `src/config.ts`
**Depends on:** Task 2, Task 4
**Interfaces:**
- Consumes: `classify`, `History`, `Phase` (Task 2); `Config` (Task 4); `maxLevel`, `rank`, `AnyLevel`, `Level` (Task 1).
- Produces:
  ```ts
  export type Decision = { level: Level; phase: Phase; source: string; floor?: string }
  export type DecideInput = {
    history: History
    stepIndex: number
    marker?: Phase              // з попереднього кроку цього треду
    floorLevel?: AnyLevel       // межа скіла/агента, якщо є
    floorLabel?: string         // 'skill:<name>' | 'agent'
  }
  export function decide(input: DecideInput, config: Config): Decision
  export function formatStatus(d: Decision): string
  ```
`decide`:
1. `marker` є → `phase = marker`, `source = 'marker'`; інакше `{phase, rule} = classify(history, { stepIndex, readStreak: config.readStreak, verifyPattern: config.verifyPattern })`, `source = 'rule:' + rule`.
2. `base = config.levels[phase]`.
3. `floorLevel` є і `rank(floorLevel) > rank(base)` → `level = maxLevel(base, floorLevel)`, `floor = \`${floorLabel ?? 'floor'}:${applyFloor(floorLevel)}\``; інакше `level = applyFloor(base)` без `floor`.

`formatStatus`: `` `⚙ ${level} · ${phase} (${source})` `` + (`floor` ? `` ` ↑${floor.split(':')[0]}` `` : ''). Приклади: `⚙ xhigh · plan (marker)`, `⚙ high · gather (rule:read) ↑skill`.

- [ ] **Step 1: тест** `tests/decide.test.ts` (з `DEFAULTS` з config):
  - маркер `implement` на кроці 0 → medium/implement/marker (маркер має пріоритет над first-step);
  - без маркера, крок 0 → xhigh/plan/`rule:first-step`;
  - Read-крок, межа `high` від `skill:review` → high, `floor === 'skill:high'`, статус `⚙ high · gather (rule:read) ↑skill`;
  - межа `medium` при фазі plan → xhigh, без `floor`;
  - межа `low` → не впливає, рівень ≥ medium;
  - `config.levels.gather = 'max'` → Read-крок дає max.
- [ ] **Step 2:** падає. **Step 3:** реалізація. **Step 4:** зелені; `tsc -p` → чисто.

---

### Task 6: `hooks/register.ts` — з'єднання з рушієм

**Writes:** `hooks/register.ts`, `tests/register.test.ts`
**Reads:** `src/*.ts`, `types/index.d.ts`, файл типів (`'turn.step'`, `TurnStepInput`, `TurnStepChunk`, `TurnStepResult`, `HookStream`, `PromptComposeSection`, `SkillPromptInput`, `TurnCompleteInput`, `atom`, `read`, `update`)
**Depends on:** Task 3, Task 5
**Interfaces:**
- Consumes: `createMarkerFilter`, `stripMarkers` (3); `decide`, `formatStatus` (5); `loadConfig` (4); `classify`-helpers `recordStep`, `startTurn`, `EMPTY_HISTORY`, `isPhase` (2); `isLevel` (1).
- Produces: `register(on, options)`; експортує також `MARKER_PROMPT: string` (для тестів).

Стан (через `atom` з `'claude-code'`, ключі — літерали):
`threads` (`{}`), `log` (`[]`), `enabled` (`config.enabled`; при першому `session.start` записати, якщо ще не писали), `baseline` (`null`), `skill` (`null`).

Хуки:
1. **`prompt.compose`**: якщо `enabled` → `const r = await next(e); return { sections: [...r.sections, { id: 'autoeffort:phase-marker', text: MARKER_PROMPT, scope: 'session' }] }`; інакше `next(e)`. `MARKER_PROMPT` (англійською, бо читає модель):
   `"Effort control: begin every response, before any tool call, with exactly one marker naming what you will do in the NEXT step, after these tool results: ⟦phase:gather⟧ (reading/searching for context), ⟦phase:plan⟧ (analysing, deciding, designing), ⟦phase:implement⟧ (writing or editing), ⟦phase:verify⟧ (running/reading tests, lint, build, reviewing). The marker is stripped before anyone sees it; do not mention it."`
2. **`skill.prompt`**: `update(skill, () => e.skill)`; `return next(e)`.
3. **`turn.complete`**: якщо `e.agentId` відсутній (основний тред; поле перевірити в `TurnCompleteInput`, якщо його немає — очищати завжди) → `update(skill, () => null)`; `return next(e)`.
4. **`turn.step`** (`async function*`):
   ```ts
   const on_ = await read($, enabled)
   if (!on_ || e.effort === undefined) return yield* next(e)
   let prep
   try { prep = await prepare($, e, config) }
   catch (err) { $.ui.log(`autoeffort: ${String(err)}`); return yield* next(e) }
   const stream = next({ ...e, effort: prep.decision.level })
   const filter = createMarkerFilter()
   let lastIndex = 0
   for await (const c of stream) {
     if (c.kind === 'text') { lastIndex = c.index; const t = filter.push(c.text); if (t) yield { ...c, text: t }; continue }
     const held = filter.flush(); if (held) yield { kind: 'text', index: lastIndex, text: held }
     yield c
   }
   const held = filter.flush(); if (held) yield { kind: 'text', index: lastIndex, text: held }
   const result = await stream.result
   try { await commit($, e, prep, filter.phase, result) } catch (err) { $.ui.log(`autoeffort: ${String(err)}`) }
   return { ...result, answer: stripMarkers(result.answer) }
   ```
   `prepare($, e, config)`:
   - `key = e.agentId ?? 'main'`; `t = threads[key] ?? { ...EMPTY_HISTORY }`; якщо `e.index === 0` → `t = { ...startTurn(t), marker: t.marker }`.
   - `incoming = typeof e.effort === 'string' && isLevel(e.effort) ? e.effort : undefined`.
   - основний тред, `skill === null`, `incoming` є → `update(baseline, () => incoming)`.
   - межа: `incoming` є, `baseline` не null, `incoming !== baseline` і (`key !== 'main'` або `skill !== null`) → `floorLevel = incoming`, `floorLabel = skill ? \`skill:${skill}\` : 'agent'`.
   - `decision = decide({ history: t, stepIndex: e.index, marker: t.marker, floorLevel, floorLabel }, config)`.
   - `$.ui.status(formatStatus(decision))`; дописати в `log` `{ at: await $.clock.now(), thread: key, step: e.index, incoming: String(e.effort), level, phase, source, floor }`, обрізати до останніх 500.
   - повернути `{ key, thread: t, decision }`.
   `commit($, e, prep, phase, result)`: `tools = result.toolUses.map(u => ({ name: u.name, command: typeof (u.input as any)?.command === 'string' ? (u.input as any).command : undefined }))`; `next = recordStep(t, tools, { resetStreak: decision.source === 'rule:read-streak' })`; записати `threads[key] = { ...next, lastPhase: decision.phase, marker: phase }` (маркер цього кроку керує наступним; `undefined` скидає).
   Усі записи — через `update($, atom, fn)`.

- [ ] **Step 1: тест** `tests/register.test.ts`. Тестовий `on('turn.step', async function* (_$, e) { seen.push(e.effort); for (const t of script.text) yield { kind: 'text', index: 0, text: t }; return { turnId: e.turnId, index: e.index, answer: script.text.join(''), toolUses: script.tools, stopReason: 'end_turn', usage: null } })` імітує модель; хелпер `step($, index, effort, agentId?)` читає `$.turn.step({ turnId: 't1', index, model: 'claude-opus-5-5', effort, messageCount: 1, agentId })` до кінця і повертає `{ chunks, result: await s.result }`. Сценарії:
  - крок 0 з `effort: 'high'` → модель отримала `xhigh`; відповідь `'⟦phase:implement⟧\nпишу'` → у чанках і `result.answer` немає `⟦`; крок 1 → `medium` (маркер implement);
  - без маркерів: крок 1 після toolUses `[{name:'Read',input:{}}]` → `medium`; після трьох таких кроків → `xhigh` (read-streak);
  - Edit, далі Bash `{command:'npm test'}` → наступний крок `xhigh` (verify);
  - вхідний `low` на кроці з фазою gather → `medium`;
  - `$.skill.prompt({ skill: 'review', text: 'x' })` (з тестовим `on('skill.prompt', (_$, e) => ({ text: e.text }))` як дном), потім крок з `effort: 'max'` при baseline `high` → `max`, а лог має `floor: 'skill:max'`;
  - субагент (`agentId: 'a1'`) має окремий стан: маркер основного треду на нього не впливає;
  - `effort` відсутній → `e` передано без змін (`seen` містить `undefined`);
  - `test('вимкнено', { options: { enabled: false } }, …)` → effort не змінено, `prompt.compose` без секції;
  - `prompt.compose`: тестове дно `on('prompt.compose', () => ({ sections: [] }))`, `await $.prompt.compose({})` → є секція `autoeffort:phase-marker` зі `scope: 'session'`.
  Точні поля інпутів (`TurnStepInput`, `PromptComposeArgs`, `SkillPromptInput`) звірити з файлом типів; якщо тестовий кіт вимагає інших полів, доповнити їх у хелпері, не змінюючи сценарії.
- [ ] **Step 2:** `claude plugin test` → нові тести падають (заглушка).
- [ ] **Step 3:** реалізувати `hooks/register.ts` як описано.
- [ ] **Step 4:** `claude plugin test` → усі зелені; `claude plugin validate` → `√ Validation passed`, у звіті `hooks:` містить `turn.step`, `prompt.compose`, `skill.prompt`, `turn.complete`, `session.start`; `tsc -p` → чисто.

---

### Task 7: команда `/autoeffort`, README

**Writes:** `hooks/register.ts`, `tests/command.test.ts`, `README.md`
**Reads:** spec §3.6, §3.8, `src/decide.ts`
**Depends on:** Task 6
**Interfaces:**
- Consumes: атоми стану й `formatStatus` з Task 6 / Task 5.
- Produces: команда `autoeffort`.

- [ ] **Step 1: тест** `tests/command.test.ts`:
  - `$.command.run({ command: 'autoeffort', args: '' })` → `text` містить `увімкнено`, рядок `baseline:` і до 20 останніх рішень у форматі `<thread>#<step> <level> · <phase> (<source>)[ ↑<floor>]`;
  - `args: 'off'` → `text === 'autoeffort вимкнено'`, далі крок `turn.step` передає `effort` без змін; `args: 'on'` → `'autoeffort увімкнено'`;
  - `args: 'log'` → усі записи логу (по рядку на запис, з часом ISO);
  - невідомий аргумент → `text` з підказкою `Використання: /autoeffort [on|off|log]`.
- [ ] **Step 2:** падає.
- [ ] **Step 3:** у `session.start` додати `await $.command.register({ name: 'autoeffort', description: 'Стан і керування autoeffort: /autoeffort [on|off|log]' })` (поля звірити з `CommandSpec`); хук `on('command.run', { command: 'autoeffort' }, async ($, e) => …)` повертає `{ text }` за сценаріями вище. `README.md`: що робить мод (таблиця фаз і рівнів), маркери, межа скіла, підлога medium, налаштування `userConfig` (через `/config` або `pluginConfigs.autoeffort.options` у `~/.claude/settings.json`), підключення `claude --plugin-dir /home/pc/projects/my-cc-mods/autoeffort` або `CLAUDE_CODE_PLUGIN_DIRS` в `env` у `~/.claude/settings.json`, команда `/autoeffort`.
- [ ] **Step 4:** `claude plugin test` → усі зелені; `claude plugin validate` → `√ Validation passed`; `tsc -p` → чисто.

---

## Фінальна перевірка (після хвилі 5)
1. У `/home/claude/autoeffort`: `claude plugin validate`, `claude plugin test`, `tsc -p` — як у заголовку.
2. Усі файли синхронізовано на комп'ютер, `git log` у `$HOME/mnt/autoeffort` показує коміт на кожну задачу.
3. Ручна перевірка (користувач, у своєму терміналі): `claude --plugin-dir /home/pc/projects/my-cc-mods/autoeffort` на задачі «прочитай → зміни → прогони тести». Статус-рядок проходить `xhigh · plan` → `medium · gather` → … → `medium · implement` → `xhigh · verify`; маркерів не видно у виводі; `/autoeffort` показує рішення з причинами.
