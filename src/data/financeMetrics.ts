import type { AppData, Appointment, Teacher } from './types'

export type FinanceData = Pick<AppData, 'appointments' | 'payments' | 'expenses' | 'membershipRedemptions'>

export type FinancialMovement = {
  amount: number
  appointmentId?: string
  date: string
  kind: 'income' | 'manual_expense' | 'guest_share'
  masterId?: string
  masterName?: string
  month: string
  sourceId: string
  teacher?: Teacher
  economicValue?: number
}

export function normalizeRatePercent(value: number) {
  if (!Number.isFinite(value)) return 50
  return Math.min(100, Math.max(0, value))
}

export function calculateGuestSplit(amount: number, ratePercent: number) {
  const masterShare = Math.round(Math.max(0, amount) * normalizeRatePercent(ratePercent) / 100)
  return { masterShare, studioShare: Math.max(0, amount) - masterShare }
}

export function expenseBelongsToTeacher(paidBy: string, teacher: Teacher) {
  const normalized = paidBy.trim().toLowerCase()
  if (teacher === 'Алина') return normalized.includes('алин')
  if (teacher === 'Настя') return normalized.includes('наст') || normalized.includes('анаст')
  return false
}

export function getFinancialMovements(data: FinanceData): FinancialMovement[] {
  const appointmentsById = new Map(data.appointments.map((appointment) => [appointment.id, appointment]))
  const movements: FinancialMovement[] = []

  const addGuestShare = (
    appointment: Appointment | undefined,
    economicValue: number,
    date: string,
    month: string,
    sourceId: string,
  ) => {
    if (!appointment?.guestMasterId || appointment.guestMasterRatePercent == null) return
    movements.push({
      amount: calculateGuestSplit(economicValue, appointment.guestMasterRatePercent).masterShare,
      appointmentId: appointment.id,
      date,
      economicValue,
      kind: 'guest_share',
      masterId: appointment.guestMasterId,
      masterName: appointment.guestMasterName ?? appointment.sourceTeacher ?? 'Приглашенный мастер',
      month,
      sourceId,
      teacher: appointment.teacher,
    })
  }

  data.payments.forEach((payment) => {
    if (!payment.cash) return
    movements.push({
      amount: payment.amount,
      appointmentId: payment.appointmentId,
      date: payment.date,
      kind: 'income',
      month: payment.month,
      sourceId: payment.id,
      teacher: payment.teacher,
    })
    if (payment.appointmentId) {
      addGuestShare(appointmentsById.get(payment.appointmentId), payment.amount, payment.date, payment.month, payment.id)
    }
  })

  data.expenses.forEach((expense) => {
    movements.push({
      amount: expense.amount,
      date: expense.date,
      kind: 'manual_expense',
      month: expense.month,
      sourceId: expense.id,
    })
  })

  data.membershipRedemptions?.forEach((redemption) => {
    if (redemption.reversedAt) return
    addGuestShare(
      appointmentsById.get(redemption.appointmentId),
      redemption.allocatedValue,
      redemption.visitDate,
      redemption.visitDate.slice(0, 7),
      redemption.id,
    )
  })

  return movements
}

export function calculateFinanceMonth(data: FinanceData, month: string) {
  const movements = getFinancialMovements(data).filter((movement) => movement.month === month)
  const income = movements.filter((movement) => movement.kind === 'income')
    .reduce((sum, movement) => sum + movement.amount, 0)
  const manualExpenses = movements.filter((movement) => movement.kind === 'manual_expense')
    .reduce((sum, movement) => sum + movement.amount, 0)
  const shares = movements.filter((movement) => movement.kind === 'guest_share')
  const guestMasterExpenses = shares.reduce((sum, movement) => sum + movement.amount, 0)
  const guestMasterReportMap = new Map<string, {
    id: string
    name: string
    appointmentIds: Set<string>
    clientPayments: number
    masterShare: number
    studioShare: number
  }>()

  shares.forEach((movement) => {
    const id = movement.masterId ?? ''
    const current = guestMasterReportMap.get(id) ?? {
      id,
      name: movement.masterName ?? 'Приглашенный мастер',
      appointmentIds: new Set<string>(),
      clientPayments: 0,
      masterShare: 0,
      studioShare: 0,
    }
    if (movement.appointmentId) current.appointmentIds.add(movement.appointmentId)
    current.clientPayments += movement.economicValue ?? 0
    current.masterShare += movement.amount
    current.studioShare += (movement.economicValue ?? 0) - movement.amount
    guestMasterReportMap.set(id, current)
  })

  const guestMasterReports = Array.from(guestMasterReportMap.values())
    .map(({ appointmentIds, ...report }) => ({ ...report, sessions: appointmentIds.size }))
    .sort((a, b) => b.masterShare - a.masterShare || a.name.localeCompare(b.name, 'ru'))
  const expenses = manualExpenses + guestMasterExpenses
  return {
    expenses,
    guestMasterExpenses,
    guestMasterReports,
    income,
    manualExpenses,
    margin: income ? (income - expenses) / income : 0,
    profit: income - expenses,
  }
}
