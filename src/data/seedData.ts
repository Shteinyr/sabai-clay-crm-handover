import type { AppData } from './types'

// Empty local demo only; studio data belongs to the configured cloud.
export const seedData: AppData = {
  meta: { generatedAt: '', sourceWorkbook: 'empty-local-demo', incomeRows: 0, expenseRows: 0, fixedExpenseRows: 0 },
  clients: [], appointments: [], deals: [], payments: [], expenses: [], fixedExpenses: [],
  certificates: [], guestMasters: [], memberships: [], membershipRedemptions: [],
  staff: ['Алина', 'Настя', 'Другое'],
  serviceTypes: ['Групповые', 'Индивидуальные', 'Свидания', 'Коворкинг'],
}
