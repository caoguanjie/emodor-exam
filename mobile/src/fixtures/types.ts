export type StaticScenarioId = string

export interface RouteScenario {
  path: string
  scenario: StaticScenarioId
  pencilBoard: string
  expectedText: string
}
