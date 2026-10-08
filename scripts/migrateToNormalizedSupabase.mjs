import process from 'node:process'
import { createClient } from '@supabase/supabase-js'

if (process.env.ALLOW_LEGACY_APP_STATE_MIGRATION !== '1') {
  throw new Error('Historical migration disabled. Never run this against a working database. See README.md.')
}

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
const supabaseKey =
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) throw new Error('An explicit target URL and key are required.')

const supabase = createClient(supabaseUrl, supabaseKey)

const compact = (value) => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined))
const dateOrNull = (value) => value || null

const clientToRow = (client) =>
  compact({
    id: client.id,
    instagram: client.instagram,
    name: client.name,
    payload: client,
    phone: client.phone,
    telegram: client.telegram,
    whatsapp: client.whatsapp,
  })

const appointmentToRow = (appointment) =>
  compact({
    amount: appointment.amount,
    appointment_date: dateOrNull(appointment.date),
    appointment_time: appointment.time,
    cash: appointment.cash,
    client_id: appointment.clientId,
    client_name: appointment.clientName,
    comment: appointment.comment,
    deal_id: appointment.dealId,
    duration_minutes: appointment.durationMinutes,
    id: appointment.id,
    instagram: appointment.instagram,
    item: appointment.item,
    paid: appointment.paid,
    payload: { ...appointment, photos: undefined },
    people_count: appointment.peopleCount,
    phone: appointment.phone,
    service_type: appointment.serviceType,
    source_teacher: appointment.sourceTeacher,
    status: appointment.status,
    teacher: appointment.teacher,
    telegram: appointment.telegram,
    whatsapp: appointment.whatsapp,
  })

const dealToRow = (deal) =>
  compact({
    amount: deal.amount,
    appointment_id: deal.appointmentId,
    client_id: deal.clientId,
    client_name: deal.clientName,
    comment: deal.comment,
    expected_ready_date: dateOrNull(deal.expectedReadyDate),
    history: deal.history ?? [],
    id: deal.id,
    item: deal.item,
    next_step: deal.nextStep,
    payload: deal,
    status: deal.status,
    teacher: deal.teacher,
    visit_date: dateOrNull(deal.visitDate),
  })

const paymentToRow = (payment) =>
  compact({
    amount: payment.amount,
    appointment_id: payment.appointmentId,
    cash: payment.cash,
    client_name: payment.clientName,
    comment: payment.comment,
    id: payment.id,
    month: payment.month,
    payment_date: dateOrNull(payment.date),
    payload: payment,
    service: payment.service,
    source: payment.source,
    source_teacher: payment.sourceTeacher,
    status: payment.status,
    teacher: payment.teacher,
    type: payment.type,
  })

const expenseToRow = (expense) =>
  compact({
    amount: expense.amount,
    category: expense.category,
    comment: expense.comment,
    description: expense.description,
    expense_date: dateOrNull(expense.date),
    id: expense.id,
    month: expense.month,
    paid_by: expense.paidBy,
    payload: expense,
    source: expense.source,
    subcategory: expense.subcategory,
    type: expense.type,
  })

const fixedExpenseToRow = (expense) =>
  compact({
    category: expense.category,
    comment: expense.comment,
    description: expense.description,
    id: expense.id,
    monthly_amount: expense.monthlyAmount,
    payload: expense,
  })

const certificateToRow = (certificate) =>
  compact({
    amount: certificate.amount,
    client_name: certificate.clientName,
    comment: certificate.comment,
    expires_at: dateOrNull(certificate.expiresAt),
    id: certificate.id,
    number: certificate.number,
    payload: certificate,
    purchase_date: dateOrNull(certificate.purchaseDate),
    purchase_payment_id: certificate.purchasePaymentId,
    teacher: certificate.teacher,
    used_at: dateOrNull(certificate.usedAt),
  })

const photoToRow = (appointmentId, photo) =>
  compact({
    appointment_id: appointmentId,
    height: photo.height,
    id: photo.id,
    path: photo.path,
    payload: photo,
    size: photo.size,
    uploaded_at: photo.uploadedAt,
    url: photo.url,
    width: photo.width,
  })

async function upsertRows(table, rows) {
  if (!rows.length) return
  const { error } = await supabase.from(table).upsert(rows, { onConflict: 'id' })
  if (error) throw new Error(`${table}: ${error.message}`)
}

async function main() {
  const { data: appState, error } = await supabase.from('app_state').select('data').eq('id', 'main').single()
  if (error) throw error

  const data = appState.data
  const photoRows = (data.appointments ?? []).flatMap((appointment) =>
    (appointment.photos ?? []).map((photo) => photoToRow(appointment.id, photo)),
  )

  const { error: snapshotError } = await supabase.from('daily_snapshots').upsert(
    {
      data,
      snapshot_date: new Date().toISOString().slice(0, 10),
      source: 'manual-pre-normalized-migration',
    },
    { onConflict: 'snapshot_date,source' },
  )
  if (snapshotError) throw new Error(`daily_snapshots: ${snapshotError.message}`)

  await upsertRows('clients', (data.clients ?? []).map(clientToRow))
  await upsertRows('appointments', (data.appointments ?? []).map(appointmentToRow))
  await upsertRows('deals', (data.deals ?? []).map(dealToRow))
  await upsertRows('payments', (data.payments ?? []).map(paymentToRow))
  await upsertRows('expenses', (data.expenses ?? []).map(expenseToRow))
  await upsertRows('fixed_expenses', (data.fixedExpenses ?? []).map(fixedExpenseToRow))
  await upsertRows('certificates', (data.certificates ?? []).map(certificateToRow))
  await upsertRows('appointment_photos', photoRows)

  console.log(
    JSON.stringify(
      {
        appointments: data.appointments?.length ?? 0,
        appointmentPhotos: photoRows.length,
        certificates: data.certificates?.length ?? 0,
        clients: data.clients?.length ?? 0,
        deals: data.deals?.length ?? 0,
        expenses: data.expenses?.length ?? 0,
        fixedExpenses: data.fixedExpenses?.length ?? 0,
        payments: data.payments?.length ?? 0,
      },
      null,
      2,
    ),
  )
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
