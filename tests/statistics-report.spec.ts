import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { calculateFinanceMonth } from '../src/data/financeMetrics'
import { collectReportPages } from '../src/data/reportPagination'
import { buildStatisticsReport } from '../src/data/statisticsReport'
import type { Appointment, StatisticsData } from '../src/data/types'

function appointment(id: string, date: string, status: Appointment['status'], amount: number): Appointment {
  return {
    id, clientId: id, clientName: `Клиент ${id}`, date, time: '12:00',
    durationMinutes: 150, peopleCount: 2, serviceType: 'Групповые', item: 'Кружка',
    amount, paid: status !== 'Бронь', cash: status !== 'Бронь', teacher: 'Другое',
    guestMasterId: 'master-1', guestMasterName: 'Сомчай', guestMasterRatePercent: 50,
    status,
  }
}

const fixture: StatisticsData = {
  appointments: [
    appointment('cash-visit', '2026-05-01', 'Ожидание изделия', 2400),
    { ...appointment('membership-visit', '2026-05-03', 'Ожидание изделия', 1200), paymentMethod: 'membership', cash: false },
    appointment('booking', '2026-05-04', 'Бронь', 1800),
  ],
  payments: [
    { id: 'cash-payment', appointmentId: 'cash-visit', date: '2026-05-01', month: '2026-05',
      type: 'Занятие', clientName: 'Клиент cash-visit', status: 'Оплачено', amount: 2400,
      teacher: 'Другое', service: 'Групповые', cash: true, source: 'test' },
    { id: 'membership-sale', date: '2026-05-02', month: '2026-05', type: 'Абонементы',
      clientName: 'Клиент', status: 'Оплачено', amount: 3900, teacher: 'Настя',
      service: 'Абонемент', cash: true, source: 'test' },
    { id: 'certificate-sale', date: '2026-05-04', month: '2026-05', type: 'Сертификаты',
      clientName: 'Клиент', status: 'Оплачено', amount: 1200, teacher: 'Алина',
      service: 'Сертификат', cash: true, source: 'test' },
  ],
  expenses: [
    { id: 'expense-1', date: '2026-05-01', month: '2026-05', paidBy: 'Настя',
      category: 'Материалы', subcategory: '', description: 'Глина', amount: 400, type: '', source: 'test' },
  ],
  fixedExpenses: [{ id: 'fixed-1', category: 'Аренда', description: 'Помещение', monthlyAmount: 9000 }],
  memberships: [
    { id: 'membership-1', clientId: 'client-1', clientName: 'Клиент', name: 'Детская лепка',
      kind: 'sessions', purchaseDate: '2026-05-02', expiresAt: '2026-11-02',
      purchaseAmount: 3900, initialSessions: 4, allowedServiceTypes: [] },
  ],
  membershipRedemptions: [
    { id: 'redemption-1', membershipId: 'membership-1', appointmentId: 'membership-visit',
      visitDate: '2026-05-03', redeemedAt: '2026-05-03T12:00:00Z', sessionsUsed: 1,
      balanceUsed: 0, allocatedValue: 975, teacher: 'Другое' },
    { id: 'reversed-1', membershipId: 'membership-1', appointmentId: 'booking',
      visitDate: '2026-05-04', redeemedAt: '2026-05-04T12:00:00Z', reversedAt: '2026-05-04T13:00:00Z',
      sessionsUsed: 1, balanceUsed: 0, allocatedValue: 975, teacher: 'Другое' },
  ],
}

test('report totals match finance and daily sums without duplicate membership revenue', () => {
  const sheets = buildStatisticsReport(fixture, '2026-05-05')
  const month = sheets.find((sheet) => sheet.name === 'По месяцам')!.rows[0]
  const days = sheets.find((sheet) => sheet.name === 'По дням')!.rows
  const finance = calculateFinanceMonth(fixture, '2026-05')

  expect(month[1]).toBe(1)
  expect(month[2]).toBe(2)
  expect(month[3]).toBe(4)
  expect(month[4]).toBe(2)
  expect(month[7]).toBe(finance.income)
  expect(month[10]).toBe(finance.expenses)
  expect(month[11]).toBe(finance.profit)
  expect(finance.income).toBe(7500)
  expect(finance.guestMasterExpenses).toBe(1688)
  expect(finance.profit).toBe(5412)
  expect(days.reduce((sum, day) => sum + Number(day[8]), 0)).toBe(finance.income)
  expect(days.reduce((sum, day) => sum + Number(day[11]), 0)).toBe(finance.expenses)
  expect(days.reduce((sum, day) => sum + Number(day[12]), 0)).toBe(finance.profit)
  expect(sheets.find((sheet) => sheet.name === 'Абонементы')!.rows).toHaveLength(2)
  expect(sheets.find((sheet) => sheet.name === 'Постоянные расходы')!.rows[0][2]).toBe(9000)
})

test('schedule has time intervals but no contacts or photos', () => {
  const data = structuredClone(fixture)
  data.appointments[0].phone = '+66123456789'
  data.appointments[0].photos = [{ id: 'photo', path: 'secret.jpg', url: 'https://example.com/secret.jpg', uploadedAt: '', width: 1, height: 1, size: 1 }]
  const sheets = buildStatisticsReport(data)
  const schedule = sheets.find((sheet) => sheet.name === 'Расписание')!
  expect(schedule.rows[0].slice(0, 3)).toEqual(['2026-05-01', '12:00', '14:30'])
  expect(JSON.stringify(sheets)).not.toContain('+66123456789')
  expect(JSON.stringify(sheets)).not.toContain('secret.jpg')
})

test('pagination loads more than 1000 records and rejects partial data', async () => {
  const rows = Array.from({ length: 1205 }, (_, index) => ({ id: `row-${index}` }))
  const fetchPage = async (from: number, to: number) => ({ rows: rows.slice(from, Math.min(to + 1, from + 300)), count: rows.length })
  expect(await collectReportPages(fetchPage, async () => rows.length)).toHaveLength(1205)
  await expect(collectReportPages(async () => ({ rows: [], count: 3 }), async () => 3)).rejects.toThrow('не все данные')
  await expect(collectReportPages(fetchPage, async () => 1206)).rejects.toThrow('изменились')
})

test('browser downloads a readable workbook with numeric money cells', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Финансы' }).click()
  await expect(page.getByRole('button', { name: 'Скачать отчёт' })).toHaveCount(0)
  const downloadPromise = page.waitForEvent('download')
  await page.evaluate(async (data) => {
    const { downloadStatisticsReport } = await import('/src/data/statisticsReport.ts')
    await downloadStatisticsReport(data)
  }, fixture)
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/^sabai-clay-report-\d{4}-\d{2}-\d{2}\.xlsx$/)
  const XLSX = await import('xlsx')
  const workbook = XLSX.read(await readFile(await download.path()), { type: 'buffer', cellNF: true })
  expect(workbook.SheetNames).toContain('По дням')
  expect(workbook.Sheets['По месяцам'].H2.t).toBe('n')
  expect(workbook.Sheets['По месяцам'].H2.v).toBe(7500)
  expect(workbook.Sheets['По месяцам'].M2.z).toBe('0.0%')
  expect(workbook.Sheets['По месяцам']['!autofilter']).toBeTruthy()
})
