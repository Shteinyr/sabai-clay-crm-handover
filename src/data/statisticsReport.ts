import { calculateFinanceMonth, expenseBelongsToTeacher, getFinancialMovements } from './financeMetrics'
import { getMembershipStatus, getMembershipUsage, remainingMembershipObligation } from './membershipLogic'
import type { Appointment, StatisticsData, Teacher } from './types'

type Cell = string | number
export type ReportSheet = { name: string; headers: string[]; rows: Cell[][] }

const staff: Teacher[] = ['Алина', 'Настя']

function monthOf(date: string) {
  return date.slice(0, 7) || 'Без месяца'
}

function dateOf(date: string) {
  return date || 'Без даты'
}

function isVisit(appointment: Appointment) {
  return appointment.status !== 'Бронь'
}

function isStudioAppointment(appointment: Appointment) {
  return appointment.serviceType !== 'Сертификаты'
}

function people(appointment: Appointment) {
  return Math.max(1, appointment.peopleCount ?? 1)
}

function duration(appointment: Appointment) {
  return Math.max(0, appointment.durationMinutes || 0)
}

function endTime(start: string, minutes: number) {
  if (!/^\d{1,2}:\d{2}$/.test(start)) return ''
  const [hours, minute] = start.split(':').map(Number)
  if (hours > 23 || minute > 59) return ''
  const total = hours * 60 + minute + minutes
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

type Day = {
  month: string
  date: string
  bookings: number
  visits: number
  people: number
  bookingPeople: number
  bookedMinutes: number
  visitMinutes: number
  income: number
  manualExpenses: number
  guestShares: number
}

function getDailyRows(data: StatisticsData) {
  const days = new Map<string, Day>()
  const ensureDay = (month: string, date: string) => {
    const key = `${month}|${date}`
    const day = days.get(key) ?? {
      month, date, bookings: 0, visits: 0, people: 0, bookingPeople: 0,
      bookedMinutes: 0, visitMinutes: 0, income: 0, manualExpenses: 0, guestShares: 0,
    }
    days.set(key, day)
    return day
  }

  data.appointments.filter(isStudioAppointment).forEach((appointment) => {
    const day = ensureDay(monthOf(appointment.date), dateOf(appointment.date))
    if (isVisit(appointment)) {
      day.visits += 1
      day.people += people(appointment)
      day.visitMinutes += duration(appointment)
    } else {
      day.bookings += 1
      day.bookingPeople += people(appointment)
      day.bookedMinutes += duration(appointment)
    }
  })

  getFinancialMovements(data).forEach((movement) => {
    const day = ensureDay(movement.month || 'Без месяца', dateOf(movement.date))
    if (movement.kind === 'income') day.income += movement.amount
    else if (movement.kind === 'manual_expense') day.manualExpenses += movement.amount
    else day.guestShares += movement.amount
  })

  return Array.from(days.values()).sort((a, b) => a.month.localeCompare(b.month) || a.date.localeCompare(b.date))
}

export function buildStatisticsReport(data: StatisticsData, today = new Date().toISOString().slice(0, 10)): ReportSheet[] {
  const appointments = data.appointments.filter(isStudioAppointment)
  const redemptions = data.membershipRedemptions.filter((redemption) => !redemption.reversedAt)
  const daily = getDailyRows(data)
  const months = Array.from(new Set([
    ...appointments.map((appointment) => monthOf(appointment.date)),
    ...data.payments.map((payment) => payment.month || monthOf(payment.date)),
    ...data.expenses.map((expense) => expense.month || monthOf(expense.date)),
    ...data.memberships.map((membership) => monthOf(membership.purchaseDate)),
    ...redemptions.map((redemption) => monthOf(redemption.visitDate)),
  ])).sort()

  const monthlyRows = months.map((month) => {
    const finance = calculateFinanceMonth(data, month === 'Без месяца' ? '' : month)
    const activity = appointments.filter((appointment) => monthOf(appointment.date) === month)
    const sales = data.memberships.filter((membership) => monthOf(membership.purchaseDate) === month)
    return [
      month, activity.filter((appointment) => !isVisit(appointment)).length,
      activity.filter(isVisit).length,
      activity.filter(isVisit).reduce((sum, appointment) => sum + people(appointment), 0),
      activity.filter((appointment) => !isVisit(appointment)).reduce((sum, appointment) => sum + people(appointment), 0),
      activity.filter((appointment) => !isVisit(appointment)).reduce((sum, appointment) => sum + duration(appointment), 0) / 60,
      activity.filter(isVisit).reduce((sum, appointment) => sum + duration(appointment), 0) / 60,
      finance.income, finance.manualExpenses, finance.guestMasterExpenses,
      finance.expenses, finance.profit, finance.margin,
      sales.length, sales.reduce((sum, membership) => sum + membership.purchaseAmount, 0),
      redemptions.filter((redemption) => monthOf(redemption.visitDate) === month).length,
    ] satisfies Cell[]
  })

  const dailyRows = daily.map((day) => {
    const expenses = day.manualExpenses + day.guestShares
    return [day.month, day.date, day.bookings, day.visits, day.people, day.bookingPeople,
      day.bookedMinutes / 60, day.visitMinutes / 60, day.income,
      day.manualExpenses, day.guestShares, expenses, day.income - expenses,
      day.income ? (day.income - expenses) / day.income : 0] satisfies Cell[]
  })

  const scheduleRows = [...appointments]
    .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time))
    .map((appointment) => [
      appointment.date, appointment.time, endTime(appointment.time, duration(appointment)),
      appointment.clientName, appointment.serviceType, appointment.item,
      appointment.guestMasterName || appointment.teacher, appointment.status,
      people(appointment), duration(appointment), appointment.amount,
      appointment.paymentMethod === 'membership' ? 'Абонемент' : 'На месте',
      appointment.membershipName ?? '', appointment.id,
    ] satisfies Cell[])

  const paymentRows = [...data.payments]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((payment) => [
      payment.date, payment.month, payment.clientName, payment.type, payment.service,
      payment.teacher, payment.status, payment.amount, payment.cash ? 'Да' : 'Нет',
      payment.source, payment.appointmentId ?? '', payment.id,
    ] satisfies Cell[])

  const expenseRows = [
    ...data.expenses.map((expense) => [
      expense.date, expense.month, expense.category, expense.description,
      expense.paidBy, expense.amount, 'Ручной расход', expense.id, '',
    ] satisfies Cell[]),
    ...getFinancialMovements(data).filter((movement) => movement.kind === 'guest_share').map((movement) => [
      movement.date, movement.month, 'Доли приглашенных мастеров',
      movement.masterName ?? '', movement.masterName ?? '', movement.amount,
      'Расчетная доля', movement.sourceId, movement.appointmentId ?? '',
    ] satisfies Cell[]),
  ].sort((a, b) => String(a[0]).localeCompare(String(b[0])))

  const masterRows = months.flatMap((month) => {
    const monthKey = month === 'Без месяца' ? '' : month
    const finance = calculateFinanceMonth(data, monthKey)
    const teacherRows = staff.map((teacher) => {
      const monthPayments = data.payments.filter((payment) => payment.month === monthKey && payment.cash && payment.teacher === teacher)
      const monthExpenses = data.expenses.filter((expense) => expense.month === monthKey && expenseBelongsToTeacher(expense.paidBy, teacher))
      const income = monthPayments.reduce((sum, payment) => sum + payment.amount, 0)
      const expenses = monthExpenses.reduce((sum, expense) => sum + expense.amount, 0)
      return [month, teacher, 'Сотрудник',
        appointments.filter((appointment) => monthOf(appointment.date) === month && appointment.teacher === teacher && isVisit(appointment)).length,
        income, redemptions.filter((redemption) => monthOf(redemption.visitDate) === month && redemption.teacher === teacher)
          .reduce((sum, redemption) => sum + redemption.allocatedValue, 0),
        0, expenses, 0, 0, income - expenses] satisfies Cell[]
    })
    const guestRows = finance.guestMasterReports.map((report) => [
      month, report.name, 'Приглашенный мастер', report.sessions, 0, 0,
      report.clientPayments, 0, report.masterShare, report.studioShare, 0,
    ] satisfies Cell[])
    return [...teacherRows, ...guestRows]
  })

  const membershipRows = data.memberships.flatMap((membership) => {
    const usage = getMembershipUsage(membership, redemptions)
    const remaining = membership.kind === 'sessions'
      ? Math.max(0, (membership.initialSessions ?? 0) - usage.sessionsUsed)
      : membership.kind === 'balance'
        ? Math.max(0, (membership.initialBalance ?? 0) - usage.balanceUsed)
        : 'Безлимит'
    const sale = [
      membership.purchaseDate, 'Продажа', membership.name, membership.clientName,
      membership.kind, membership.purchaseAmount, membership.initialSessions ?? 0,
      membership.initialBalance ?? 0, 0, 0, 0,
      remaining, remainingMembershipObligation(membership, redemptions),
      getMembershipStatus(membership, redemptions, today), membership.expiresAt, '', membership.id,
    ] satisfies Cell[]
    const visits = redemptions.filter((redemption) => redemption.membershipId === membership.id).map((redemption) => [
      redemption.visitDate, 'Посещение', membership.name, membership.clientName,
      membership.kind, 0, 0, 0, redemption.sessionsUsed, redemption.balanceUsed,
      redemption.allocatedValue, 0, 0, '', membership.expiresAt,
      redemption.appointmentId, membership.id,
    ] satisfies Cell[])
    return [sale, ...visits]
  }).sort((a, b) => String(a[0]).localeCompare(String(b[0])))

  return [
    { name: 'По месяцам', headers: ['Месяц', 'Брони', 'Посещения', 'Гостей на занятиях', 'Гостей по броням', 'Часы броней', 'Часы занятий', 'Доход THB', 'Ручные расходы THB', 'Доли мастеров THB', 'Все расходы THB', 'Прибыль THB', 'Маржа', 'Абонементов продано', 'Продажи абонементов THB', 'Посещения по абонементам'], rows: monthlyRows },
    { name: 'По дням', headers: ['Месяц учета', 'Дата', 'Брони', 'Посещения', 'Гостей на занятиях', 'Гостей по броням', 'Часы броней', 'Часы занятий', 'Доход THB', 'Ручные расходы THB', 'Доли мастеров THB', 'Все расходы THB', 'Прибыль THB', 'Маржа'], rows: dailyRows },
    { name: 'Расписание', headers: ['Дата', 'Начало', 'Окончание', 'Клиент', 'Тип занятия', 'Изделие или услуга', 'Проводит', 'Статус', 'Гостей', 'Длительность, мин', 'Стоимость записи THB', 'Способ оплаты', 'Абонемент', 'ID записи'], rows: scheduleRows },
    { name: 'Платежи', headers: ['Дата', 'Месяц учета', 'Клиент', 'Тип', 'Услуга', 'Преподаватель', 'Статус', 'Сумма THB', 'В доходе', 'Источник', 'ID записи', 'ID платежа'], rows: paymentRows },
    { name: 'Расходы', headers: ['Дата', 'Месяц учета', 'Категория', 'Описание', 'Кому или кем', 'Сумма THB', 'Тип', 'ID источника', 'ID записи'], rows: expenseRows },
    { name: 'Мастера', headers: ['Месяц', 'Имя', 'Роль', 'Занятий', 'Кассовый доход THB', 'Занятия по абонементам THB', 'Стоимость занятий мастера THB', 'Ручные расходы THB', 'Доля мастера THB', 'Доля студии THB', 'Прибыль сотрудника THB'], rows: masterRows },
    { name: 'Абонементы', headers: ['Дата', 'Событие', 'Название', 'Клиент', 'Тип', 'Получено THB', 'Занятий в пакете', 'Номинал THB', 'Списано занятий', 'Списано баланса THB', 'Стоимость посещения THB', 'Остаток', 'Обязательство THB', 'Статус', 'Действует до', 'ID записи', 'ID абонемента'], rows: membershipRows },
    { name: 'Постоянные расходы', headers: ['Категория', 'Описание', 'Справочная сумма в месяц THB'], rows: data.fixedExpenses.map((expense) => [expense.category, expense.description, expense.monthlyAmount]) },
  ]
}

export async function downloadStatisticsReport(data: StatisticsData) {
  const XLSX = await import('xlsx')
  const workbook = XLSX.utils.book_new()
  buildStatisticsReport(data).forEach(({ name, headers, rows }) => {
    const sheet = XLSX.utils.aoa_to_sheet([headers, ...rows])
    headers.forEach((header, column) => {
      const format = header === 'Маржа'
        ? '0.0%'
        : header.endsWith('THB')
          ? '#,##0.00 "THB"'
          : header.startsWith('Часы ')
            ? '0.00'
            : undefined
      if (!format) return
      rows.forEach((row, index) => {
        if (typeof row[column] !== 'number') return
        const cell = sheet[XLSX.utils.encode_cell({ r: index + 1, c: column })]
        if (cell) cell.z = format
      })
    })
    sheet['!cols'] = headers.map((header, index) => ({
      wch: Math.min(36, Math.max(13, header.length + 2, ...rows.map((row) => String(row[index] ?? '').length + 2))),
    }))
    sheet['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length, c: headers.length - 1 } }) }
    XLSX.utils.book_append_sheet(workbook, sheet, name)
  })
  const content = XLSX.write(workbook, { bookType: 'xlsx', type: 'array', compression: true })
  const url = URL.createObjectURL(new Blob([content], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `sabai-clay-report-${new Date().toISOString().slice(0, 10)}.xlsx`
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
