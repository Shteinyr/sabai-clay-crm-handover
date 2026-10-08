import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import XLSX from 'xlsx'

if (process.env.ALLOW_LEGACY_SEED_GENERATION !== '1') {
  throw new Error('Historical Excel seed generation is disabled. Never use it for the working studio database.')
}
const workbookPath = process.argv[2]
if (!workbookPath) throw new Error('An explicit local workbook path is required.')
const outputPath = path.resolve('src/data/seedData.ts')

const workbook = XLSX.readFile(workbookPath, { cellDates: true })

const sheet = (name) =>
  XLSX.utils.sheet_to_json(workbook.Sheets[name], {
    defval: '',
    raw: true,
  })

const rawRows = sheet('Лист1')
const incomeRows = sheet('Доходы')
const expenseRows = sheet('Расходы')
const fixedRows = sheet('Постоянные')

const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim()
const amount = (value) => {
  if (typeof value === 'number') return value
  const text = clean(value).replace(/\s/g, '').replace(/,/g, '')
  if (!text || /бартер/i.test(text)) return 0
  const parsed = Number(text)
  return Number.isFinite(parsed) ? parsed : 0
}
const isBarter = (value) => /бартер/i.test(clean(value))
const slug = (value) =>
  clean(value)
    .toLowerCase()
    .replace(/[^a-zа-яё0-9]+/gi, '-')
    .replace(/^-|-$/g, '')

const excelDate = (value) => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const corrected = new Date(value)
    corrected.setUTCDate(corrected.getUTCDate() + 1)
    return `${corrected.getUTCFullYear()}-${String(corrected.getUTCMonth() + 1).padStart(2, '0')}-${String(corrected.getUTCDate()).padStart(2, '0')}`
  }
  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value)
    if (parsed) {
      return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`
    }
  }
  const text = clean(value)
  if (!text) return ''
  const parsed = new Date(text)
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10)
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (match) return `${match[1]}-${match[2]}-${match[3]}`
  return ''
}
const monthOf = (date, fallback = '') => (date ? date.slice(0, 7) : clean(fallback) || 'Без даты')

const addDays = (date, days) => {
  if (!date) return ''
  const [year, month, day] = date.split('-').map(Number)
  const parsed = new Date(Date.UTC(year, month - 1, day))
  parsed.setUTCDate(parsed.getUTCDate() + days)
  return `${parsed.getUTCFullYear()}-${String(parsed.getUTCMonth() + 1).padStart(2, '0')}-${String(parsed.getUTCDate()).padStart(2, '0')}`
}

const normalizeTeacher = (value) => {
  const text = clean(value).toLowerCase()
  if (text.includes('алина')) return 'Алина'
  if (text.includes('настя')) return 'Настя'
  return 'Другое'
}

const normalizeDealStatus = (value, hasItem = true) => {
  const text = clean(value).toLowerCase()
  if (text.includes('выдан')) return 'Сделка закрыта'
  if (text.includes('выдали')) return 'Сделка закрыта'
  if (text.includes('оповест') || text.includes('оаовест')) return 'Клиент оповещен'
  if (text.includes('готов')) return 'Готово к выдаче'
  if (!hasItem) return 'Проведен'
  if (!text || text === '-') return 'Ожидание изделия'
  return 'Изделие в работе'
}

const nextStepFor = (status) => {
  const steps = {
    Бронь: 'Провести занятие',
    Посещение: 'Передать изделие в работу',
    'Изделие в работе': 'Дождаться готовности',
    'Ожидание изделия': 'Проверить готовность',
    'Готово к выдаче': 'Оповестить клиента',
    'Клиент оповещен': 'Выдать изделие',
    'Изделие выдано': 'Закрыть сделку',
    'Сделка закрыта': 'Закрыто',
  }
  return steps[status] ?? 'Проверить следующий шаг'
}

const contactFromSocial = (social) => {
  const text = clean(social)
  if (!text) return {}
  if (text.includes('instagram.com')) return { instagram: text }
  if (text.startsWith('@')) return { telegram: text }
  return { instagram: text }
}

const clientsByKey = new Map()
const clients = []
const ensureClient = (name, contact = {}) => {
  const safeName = clean(name) || 'Без имени'
  const key = slug(safeName)
  const existing = clientsByKey.get(key)
  if (existing) {
    Object.assign(existing, Object.fromEntries(Object.entries(contact).filter(([, v]) => v)))
    return existing
  }
  const client = {
    id: `client-${clients.length + 1}`,
    name: safeName,
    ...Object.fromEntries(Object.entries(contact).filter(([, v]) => v)),
  }
  clientsByKey.set(key, client)
  clients.push(client)
  return client
}

const serviceTypes = Array.from(
  new Set(incomeRows.map((row) => clean(row['Тип'])).filter(Boolean)),
)

const payments = incomeRows.map((row, index) => {
  const date = excelDate(row['Дата'])
  const rawTeacher = clean(row['Кто провел'])
  const rawStatus = clean(row['Статус'])
  const cash = !isBarter(row['Сумма THB']) && amount(row['Сумма THB']) > 0
  return {
    id: `payment-${index + 1}`,
    date,
    month: monthOf(date, row['Месяц']),
    type: clean(row['Тип']) || 'Запись',
    clientName: clean(row['Клиент']) || 'Без имени',
    status: rawStatus,
    amount: amount(row['Сумма THB']),
    teacher: normalizeTeacher(rawTeacher),
    sourceTeacher: rawTeacher,
    service: clean(row['Изделие/услуга']) || 'Услуга',
    cash,
    source: clean(row['Источник']),
    comment: clean(row['Комментарий']),
  }
})

const appointments = []
const deals = []
const appointmentBySignature = new Map()

payments.forEach((payment, index) => {
  const client = ensureClient(payment.clientName)
  const hasItem =
    payment.service &&
    !/сертификат|аренда|коворкинг/i.test(`${payment.service} ${payment.type}`)
  const status = normalizeDealStatus(payment.status, hasItem)
  const appointment = {
    id: `appointment-${appointments.length + 1}`,
    clientId: client.id,
    clientName: client.name,
    date: payment.date,
    time: `${String(10 + (index % 8)).padStart(2, '0')}:00`,
    durationMinutes: payment.type === 'Индивидуальные' ? 120 : 150,
    serviceType: payment.type,
    item: payment.service,
    amount: payment.amount,
    paid: payment.cash,
    cash: payment.cash,
    teacher: payment.teacher,
    sourceTeacher: payment.sourceTeacher,
    status,
    comment: payment.comment,
  }
  appointments.push(appointment)
  appointmentBySignature.set(
    `${payment.date}|${payment.clientName}|${payment.amount}|${payment.service}`,
    appointment,
  )
  payment.appointmentId = appointment.id

  if (hasItem && payment.date) {
    const deal = {
      id: `deal-${deals.length + 1}`,
      appointmentId: appointment.id,
      clientId: client.id,
      clientName: client.name,
      visitDate: payment.date,
      teacher: payment.teacher,
      status,
      expectedReadyDate: addDays(payment.date, 21),
      nextStep: nextStepFor(status),
      amount: payment.amount,
      item: payment.service,
      comment: payment.status && !['Выдано', 'Выдали', 'Оповестили'].includes(payment.status) ? payment.status : '',
      history: [{ date: payment.date, status, note: 'Импорт из Excel' }],
    }
    deals.push(deal)
    appointment.dealId = deal.id
  }
})

rawRows.forEach((row) => {
  const name = clean(row['Имя клиента'])
  const hasBarterMarker = Object.values(row).some((value) => /бартер/i.test(clean(value)))
  if (!name || !hasBarterMarker) return
  const date = excelDate(row['Дата мастер-класса'])
  const serviceType = 'Бартер'
  const item = clean(row['Изделие ']) || clean(row['Описание изделия ']) || 'Услуга'
  const signature = `${date}|${name}|0|${item}`
  if (appointmentBySignature.has(signature)) return
  const contact = {
    phone: clean(row['Сколько ']),
    whatsapp: clean(row['Сколько ']),
    ...contactFromSocial(row['Соц сети ']),
  }
  const client = ensureClient(name, contact)
  const rawTeacher = clean(row['Кто провел '])
  const status = normalizeDealStatus(row['Статус изделия'], Boolean(item))
  const appointment = {
    id: `appointment-${appointments.length + 1}`,
    clientId: client.id,
    clientName: client.name,
    ...contact,
    date,
    time: '12:00',
    durationMinutes: 150,
    serviceType,
    item,
    amount: 0,
    paid: false,
    cash: false,
    teacher: normalizeTeacher(rawTeacher),
    sourceTeacher: rawTeacher,
    status,
    comment: clean(row['Описание изделия ']) || 'Бартер, не денежная выручка',
  }
  appointments.push(appointment)
  if (date && item) {
    const deal = {
      id: `deal-${deals.length + 1}`,
      appointmentId: appointment.id,
      clientId: client.id,
      clientName: client.name,
      visitDate: date,
      teacher: appointment.teacher,
      status,
      expectedReadyDate: addDays(date, 21),
      nextStep: nextStepFor(status),
      amount: 0,
      item,
      comment: appointment.comment,
      history: [{ date, status, note: 'Бартер из Excel' }],
    }
    deals.push(deal)
    appointment.dealId = deal.id
  }
})

const expenses = expenseRows.map((row, index) => {
  const date = excelDate(row['Дата'])
  return {
    id: `expense-${index + 1}`,
    date,
    month: monthOf(date, row['Месяц']),
    paidBy: clean(row['Оплатил']) || 'Не указано',
    category: clean(row['Категория']) || 'Прочее',
    subcategory: clean(row['Подкатегория']),
    description: clean(row['Описание']),
    amount: amount(row['Сумма THB']),
    type: clean(row['Тип']) || 'Факт',
    source: clean(row['Источник']),
    comment: clean(row['Комментарий']),
  }
})

const fixedExpenses = fixedRows
  .filter((row) => clean(row['Категория']))
  .map((row, index) => ({
    id: `fixed-${index + 1}`,
    category: clean(row['Категория']),
    description: clean(row['Описание']),
    monthlyAmount: amount(row['Сумма THB/мес']),
    comment: clean(row['Комментарий']),
  }))

const seedData = {
  meta: {
    generatedAt: new Date().toISOString(),
    sourceWorkbook: workbookPath,
    incomeRows: incomeRows.length,
    expenseRows: expenseRows.length,
    fixedExpenseRows: fixedExpenses.length,
  },
  clients,
  appointments,
  deals,
  payments,
  expenses,
  fixedExpenses,
  staff: ['Алина', 'Настя', 'Другое'],
  serviceTypes: Array.from(new Set([...serviceTypes, 'Бартер', 'Групповые', 'Свидание', 'Индивидуальные'])),
}

const content = `import type { AppData } from './types'\n\nexport const seedData = ${JSON.stringify(
  seedData,
  null,
  2,
)} satisfies AppData\n`

fs.writeFileSync(outputPath, content)

const cashIncome = payments.filter((payment) => payment.cash).reduce((sum, row) => sum + row.amount, 0)
const expenseTotal = expenses.reduce((sum, row) => sum + row.amount, 0)
console.log(
  JSON.stringify(
    {
      outputPath,
      clients: clients.length,
      appointments: appointments.length,
      deals: deals.length,
      incomeRows: incomeRows.length,
      expenseRows: expenseRows.length,
      fixedExpenseRows: fixedExpenses.length,
      cashIncome,
      expenseTotal,
    },
    null,
    2,
  ),
)
