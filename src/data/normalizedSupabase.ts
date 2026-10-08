import { supabase } from './supabaseClient'
import { collectReportPages } from './reportPagination'
import type {
  AppData,
  Appointment,
  Certificate,
  Client,
  Deal,
  Expense,
  FixedExpense,
  GuestMaster,
  Membership,
  MembershipRedemption,
  Payment,
  ProductPhoto,
  StatisticsData,
  Teacher,
} from './types'

type CloudTable =
  | 'clients'
  | 'appointments'
  | 'deals'
  | 'payments'
  | 'expenses'
  | 'fixed_expenses'
  | 'certificates'
  | 'appointment_photos'
  | 'guest_masters'
  | 'memberships'
  | 'membership_redemptions'

type CloudRow = Record<string, unknown>

type SoftDeleteInput = Partial<Record<CloudTable, string[]>>

const activeTables: CloudTable[] = [
  'clients',
  'appointments',
  'deals',
  'payments',
  'expenses',
  'fixed_expenses',
  'certificates',
  'appointment_photos',
  'guest_masters',
  'memberships',
  'membership_redemptions',
]

const metaFallback = {
  expenseRows: 0,
  fixedExpenseRows: 0,
  generatedAt: new Date().toISOString(),
  incomeRows: 0,
  sourceWorkbook: 'Supabase tables',
}

function toNumber(value: unknown) {
  const numberValue = Number(value ?? 0)
  return Number.isFinite(numberValue) ? numberValue : 0
}

function toText(value: unknown) {
  return String(value ?? '')
}

function toTeacher(value: unknown): Teacher {
  const text = toText(value)
  return text === 'Алина' || text === 'Настя' ? text : 'Другое'
}

function withPayload<T extends { id: string }>(row: CloudRow, base: T) {
  return {
    ...((row.payload as Partial<T> | null) ?? {}),
    ...base,
  }
}

function clientFromRow(row: CloudRow): Client {
  return withPayload(row, {
    id: toText(row.id),
    instagram: toText(row.instagram) || undefined,
    name: toText(row.name),
    phone: toText(row.phone) || undefined,
    telegram: toText(row.telegram) || undefined,
    whatsapp: toText(row.whatsapp) || undefined,
  })
}

function appointmentFromRow(row: CloudRow, photos: ProductPhoto[]): Appointment {
  return withPayload(row, {
    amount: toNumber(row.amount),
    cash: Boolean(row.cash),
    clientId: toText(row.client_id),
    clientName: toText(row.client_name),
    comment: toText(row.comment) || undefined,
    date: toText(row.appointment_date),
    dealId: toText(row.deal_id) || undefined,
    durationMinutes: toNumber(row.duration_minutes),
    id: toText(row.id),
    instagram: toText(row.instagram) || undefined,
    item: toText(row.item),
    paid: Boolean(row.paid),
    peopleCount: row.people_count == null ? undefined : toNumber(row.people_count),
    phone: toText(row.phone) || undefined,
    photos,
    serviceType: toText(row.service_type),
    sourceTeacher: toText(row.source_teacher) || undefined,
    guestMasterId: toText(row.guest_master_id) || undefined,
    guestMasterName: toText(row.guest_master_name) || undefined,
    guestMasterRatePercent: row.guest_master_rate_percent == null
      ? undefined
      : toNumber(row.guest_master_rate_percent),
    paymentMethod: toText(row.payment_method) === 'membership' ? 'membership' : 'cash',
    membershipId: toText(row.membership_id) || undefined,
    membershipName: toText(row.membership_name) || undefined,
    membershipChargeAmount: row.membership_charge_amount == null
      ? undefined
      : toNumber(row.membership_charge_amount),
    status: toText(row.status) as Appointment['status'],
    teacher: toTeacher(row.teacher),
    telegram: toText(row.telegram) || undefined,
    time: toText(row.appointment_time),
    whatsapp: toText(row.whatsapp) || undefined,
  })
}

function dealFromRow(row: CloudRow): Deal {
  return withPayload(row, {
    amount: toNumber(row.amount),
    appointmentId: toText(row.appointment_id),
    clientId: toText(row.client_id),
    clientName: toText(row.client_name),
    comment: toText(row.comment) || undefined,
    expectedReadyDate: toText(row.expected_ready_date),
    history: Array.isArray(row.history) ? row.history : [],
    id: toText(row.id),
    item: toText(row.item),
    nextStep: toText(row.next_step),
    status: toText(row.status) as Deal['status'],
    teacher: toTeacher(row.teacher),
    visitDate: toText(row.visit_date),
  })
}

function paymentFromRow(row: CloudRow): Payment {
  return withPayload(row, {
    amount: toNumber(row.amount),
    appointmentId: toText(row.appointment_id) || undefined,
    cash: Boolean(row.cash),
    clientName: toText(row.client_name),
    comment: toText(row.comment) || undefined,
    date: toText(row.payment_date),
    id: toText(row.id),
    month: toText(row.month),
    service: toText(row.service),
    source: toText(row.source),
    sourceTeacher: toText(row.source_teacher) || undefined,
    status: toText(row.status),
    teacher: toTeacher(row.teacher),
    type: toText(row.type),
  })
}

function expenseFromRow(row: CloudRow): Expense {
  return withPayload(row, {
    amount: toNumber(row.amount),
    category: toText(row.category),
    comment: toText(row.comment) || undefined,
    date: toText(row.expense_date),
    description: toText(row.description),
    id: toText(row.id),
    month: toText(row.month),
    paidBy: toText(row.paid_by),
    source: toText(row.source),
    subcategory: toText(row.subcategory),
    type: toText(row.type),
  })
}

function fixedExpenseFromRow(row: CloudRow): FixedExpense {
  return withPayload(row, {
    category: toText(row.category),
    comment: toText(row.comment) || undefined,
    description: toText(row.description),
    id: toText(row.id),
    monthlyAmount: toNumber(row.monthly_amount),
  })
}

function guestMasterFromRow(row: CloudRow): GuestMaster {
  return withPayload(row, {
    defaultRatePercent: toNumber(row.default_rate_percent),
    id: toText(row.id),
    isActive: Boolean(row.is_active),
    name: toText(row.name),
  })
}

function membershipFromRow(row: CloudRow): Membership {
  return withPayload(row, {
    allowedServiceTypes: Array.isArray(row.allowed_service_types)
      ? row.allowed_service_types.map(toText)
      : [],
    clientId: toText(row.client_id),
    clientName: toText(row.client_name),
    comment: toText(row.comment) || undefined,
    expiresAt: toText(row.expires_at),
    id: toText(row.id),
    initialBalance: row.initial_balance == null ? undefined : toNumber(row.initial_balance),
    initialSessions: row.initial_sessions == null ? undefined : toNumber(row.initial_sessions),
    instagram: toText(row.instagram) || undefined,
    kind: toText(row.kind) as Membership['kind'],
    name: toText(row.name),
    phone: toText(row.phone) || undefined,
    purchaseAmount: toNumber(row.purchase_amount),
    purchaseDate: toText(row.purchase_date),
    purchasePaymentId: toText(row.purchase_payment_id) || undefined,
    telegram: toText(row.telegram) || undefined,
    whatsapp: toText(row.whatsapp) || undefined,
  })
}

export function membershipRedemptionFromRow(row: CloudRow): MembershipRedemption {
  return withPayload(row, {
    allocatedValue: toNumber(row.allocated_value),
    appointmentId: toText(row.appointment_id),
    balanceUsed: toNumber(row.balance_used),
    guestMasterId: toText(row.guest_master_id) || undefined,
    guestMasterName: toText(row.guest_master_name) || undefined,
    guestMasterRatePercent: row.guest_master_rate_percent == null
      ? undefined
      : toNumber(row.guest_master_rate_percent),
    id: toText(row.id),
    membershipId: toText(row.membership_id),
    redeemedAt: toText(row.redeemed_at),
    reversedAt: toText(row.reversed_at) || undefined,
    sessionsUsed: toNumber(row.sessions_used),
    teacher: toTeacher(row.teacher),
    visitDate: toText(row.visit_date),
  })
}

function certificateFromRow(row: CloudRow): Certificate {
  return withPayload(row, {
    amount: toNumber(row.amount),
    clientName: toText(row.client_name),
    comment: toText(row.comment) || undefined,
    expiresAt: toText(row.expires_at),
    id: toText(row.id),
    number: toText(row.number),
    purchaseDate: toText(row.purchase_date),
    purchasePaymentId: toText(row.purchase_payment_id) || undefined,
    teacher: row.teacher ? toTeacher(row.teacher) : undefined,
    usedAt: toText(row.used_at) || undefined,
  })
}

function photoFromRow(row: CloudRow): ProductPhoto {
  const path = toText(row.path)
  return withPayload(row, {
    height: toNumber(row.height),
    id: toText(row.id),
    path,
    size: toNumber(row.size),
    uploadedAt: toText(row.uploaded_at),
    url: supabase && path ? supabase.storage.from('deal-photos').getPublicUrl(path).data.publicUrl : toText(row.url),
    width: toNumber(row.width),
  })
}

function compact<T extends object>(value: T) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T
}

function dateOrNull(value: string | undefined) {
  return value || null
}

function clientToRow(client: Client): CloudRow {
  return compact({
    id: client.id,
    instagram: client.instagram,
    name: client.name,
    payload: client,
    phone: client.phone,
    telegram: client.telegram,
    whatsapp: client.whatsapp,
  })
}

function appointmentToRow(appointment: Appointment): CloudRow {
  return compact({
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
    guest_master_id: appointment.guestMasterId,
    guest_master_name: appointment.guestMasterName,
    guest_master_rate_percent: appointment.guestMasterRatePercent,
    payment_method: appointment.paymentMethod ?? 'cash',
    membership_id: appointment.membershipId,
    membership_name: appointment.membershipName,
    membership_charge_amount: appointment.membershipChargeAmount,
    status: appointment.status,
    teacher: appointment.teacher,
    telegram: appointment.telegram,
    whatsapp: appointment.whatsapp,
  })
}

function dealToRow(deal: Deal): CloudRow {
  return compact({
    amount: deal.amount,
    appointment_id: deal.appointmentId,
    client_id: deal.clientId,
    client_name: deal.clientName,
    comment: deal.comment,
    expected_ready_date: dateOrNull(deal.expectedReadyDate),
    history: deal.history,
    id: deal.id,
    item: deal.item,
    next_step: deal.nextStep,
    payload: deal,
    status: deal.status,
    teacher: deal.teacher,
    visit_date: dateOrNull(deal.visitDate),
  })
}

function paymentToRow(payment: Payment): CloudRow {
  return compact({
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
}

function expenseToRow(expense: Expense): CloudRow {
  return compact({
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
}

function fixedExpenseToRow(expense: FixedExpense): CloudRow {
  return compact({
    category: expense.category,
    comment: expense.comment,
    description: expense.description,
    id: expense.id,
    monthly_amount: expense.monthlyAmount,
    payload: expense,
  })
}

function guestMasterToRow(master: GuestMaster): CloudRow {
  return compact({
    default_rate_percent: master.defaultRatePercent,
    id: master.id,
    is_active: master.isActive,
    name: master.name,
    payload: master,
  })
}

function membershipToRow(membership: Membership): CloudRow {
  return compact({
    allowed_service_types: membership.allowedServiceTypes,
    client_id: membership.clientId,
    client_name: membership.clientName,
    comment: membership.comment,
    expires_at: dateOrNull(membership.expiresAt),
    id: membership.id,
    initial_balance: membership.initialBalance,
    initial_sessions: membership.initialSessions,
    instagram: membership.instagram,
    kind: membership.kind,
    name: membership.name,
    payload: membership,
    phone: membership.phone,
    purchase_amount: membership.purchaseAmount,
    purchase_date: dateOrNull(membership.purchaseDate),
    purchase_payment_id: membership.purchasePaymentId,
    telegram: membership.telegram,
    whatsapp: membership.whatsapp,
  })
}

function membershipRedemptionToRow(redemption: MembershipRedemption): CloudRow {
  return compact({
    allocated_value: redemption.allocatedValue,
    appointment_id: redemption.appointmentId,
    balance_used: redemption.balanceUsed,
    guest_master_id: redemption.guestMasterId,
    guest_master_name: redemption.guestMasterName,
    guest_master_rate_percent: redemption.guestMasterRatePercent,
    id: redemption.id,
    membership_id: redemption.membershipId,
    payload: redemption,
    redeemed_at: redemption.redeemedAt,
    reversed_at: dateOrNull(redemption.reversedAt),
    sessions_used: redemption.sessionsUsed,
    teacher: redemption.teacher,
    visit_date: dateOrNull(redemption.visitDate),
  })
}

function certificateToRow(certificate: Certificate): CloudRow {
  return compact({
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
}

function photoToRow(appointmentId: string, photo: ProductPhoto): CloudRow {
  return compact({
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
}

async function selectActive(table: CloudTable) {
  if (!supabase) return []
  const { data, error } = await supabase.from(table).select('*').is('deleted_at', null)
  if (error) throw error
  return (data ?? []) as CloudRow[]
}

async function selectAuthenticatedTable(table: 'guest_masters' | 'memberships' | 'membership_redemptions') {
  if (!supabase) return []
  const { data: authData } = await supabase.auth.getSession()
  if (!authData.session) return []
  return selectActive(table)
}

async function loadLegacyAppState() {
  if (!supabase) return null
  const { data, error } = await supabase.from('app_state').select('data').eq('id', 'main').maybeSingle()
  if (error) throw error
  return (data?.data as AppData | undefined) ?? null
}

async function loadLegacyMeta() {
  const legacy = await loadLegacyAppState()
  return legacy?.meta ?? metaFallback
}

export async function loadNormalizedAppData() {
  if (!supabase) return null

  try {
    const [clients, appointments, deals, payments, expenses, fixedExpenses, certificates, photos, guestMasters, memberships, membershipRedemptions] =
      await Promise.all([
        selectActive('clients'),
        selectActive('appointments'),
        selectActive('deals'),
        selectActive('payments'),
        selectActive('expenses'),
        selectActive('fixed_expenses'),
        selectActive('certificates'),
        selectActive('appointment_photos'),
        selectAuthenticatedTable('guest_masters'),
        selectAuthenticatedTable('memberships'),
        selectAuthenticatedTable('membership_redemptions'),
      ])

    const hasNormalizedData = activeTables.some((_, index) => {
      const groups = [clients, appointments, deals, payments, expenses, fixedExpenses, certificates, photos, guestMasters, memberships, membershipRedemptions]
      return (groups[index]?.length ?? 0) > 0
    })

    if (!hasNormalizedData) return loadLegacyAppState()

    const photosByAppointment = new Map<string, ProductPhoto[]>()
    photos.forEach((row) => {
      const appointmentId = toText(row.appointment_id)
      const current = photosByAppointment.get(appointmentId) ?? []
      current.push(photoFromRow(row))
      photosByAppointment.set(appointmentId, current)
    })

    return {
      meta: await loadLegacyMeta(),
      appointments: appointments.map((row) => appointmentFromRow(row, photosByAppointment.get(toText(row.id)) ?? [])),
      certificates: certificates.map(certificateFromRow),
      clients: clients.map(clientFromRow),
      deals: deals.map(dealFromRow),
      expenses: expenses.map(expenseFromRow),
      fixedExpenses: fixedExpenses.map(fixedExpenseFromRow),
      guestMasters: guestMasters.map(guestMasterFromRow),
      memberships: memberships.map(membershipFromRow),
      membershipRedemptions: membershipRedemptions.map(membershipRedemptionFromRow),
      payments: payments.map(paymentFromRow),
      serviceTypes: Array.from(new Set(appointments.map((row) => toText(row.service_type)).filter(Boolean))),
      staff: ['Алина', 'Настя', 'Другое'],
    } satisfies AppData
  } catch {
    return loadLegacyAppState()
  }
}

const reportPageSize = 500

async function selectAllActiveForReport(table: CloudTable): Promise<CloudRow[]> {
  const client = supabase
  if (!client) throw new Error('Supabase не подключен.')
  return collectReportPages(
    async (from, to) => {
      const { data, count, error } = await client
        .from(table)
        .select('*', { count: 'exact' })
        .is('deleted_at', null)
        .order('id')
        .range(from, to)
      if (error) throw new Error(`Не удалось загрузить ${table}: ${error.message}`)
      return { rows: (data ?? []) as CloudRow[], count }
    },
    async () => {
      const { count, error } = await client
        .from(table)
        .select('id', { count: 'exact', head: true })
        .is('deleted_at', null)
      if (error) throw new Error(`Не удалось проверить ${table}: ${error.message}`)
      return count
    },
    reportPageSize,
  )
}

export async function loadStatisticsData(): Promise<StatisticsData> {
  if (!supabase) throw new Error('Для отчёта требуется подключение к Supabase.')
  const [appointments, payments, expenses, fixedExpenses, memberships, membershipRedemptions] = await Promise.all([
    selectAllActiveForReport('appointments'),
    selectAllActiveForReport('payments'),
    selectAllActiveForReport('expenses'),
    selectAllActiveForReport('fixed_expenses'),
    selectAllActiveForReport('memberships'),
    selectAllActiveForReport('membership_redemptions'),
  ])

  return {
    appointments: appointments.map((row) => appointmentFromRow(row, [])),
    expenses: expenses.map(expenseFromRow),
    fixedExpenses: fixedExpenses.map(fixedExpenseFromRow),
    memberships: memberships.map(membershipFromRow),
    membershipRedemptions: membershipRedemptions.map(membershipRedemptionFromRow),
    payments: payments.map(paymentFromRow),
  }
}

async function upsertRows(table: CloudTable, rows: CloudRow[]) {
  if (!supabase || !rows.length) return
  const { error } = await supabase.from(table).upsert(rows, { onConflict: 'id' })
  if (error) throw error
}

async function loadDeletedIds() {
  if (!supabase) return new Map<CloudTable, Set<string>>()
  const client = supabase

  const result = new Map<CloudTable, Set<string>>()
  await Promise.all(
    activeTables.map(async (table) => {
      const { data, error } = await client.from(table).select('id').not('deleted_at', 'is', null)
      if (error) throw error
      result.set(table, new Set((data ?? []).map((row) => toText((row as CloudRow).id))))
    }),
  )
  return result
}

function excludeDeleted<T extends { id: string }>(table: CloudTable, items: T[], deletedIds: Map<CloudTable, Set<string>>) {
  const ids = deletedIds.get(table) ?? new Set<string>()
  return items.filter((item) => !ids.has(item.id))
}

export async function saveNormalizedAppData(data: AppData) {
  const deletedIds = await loadDeletedIds()
  const activeAppointments = excludeDeleted('appointments', data.appointments, deletedIds)
  const appointmentPhotos = activeAppointments.flatMap((appointment) =>
    (appointment.photos ?? [])
      .filter((photo) => !(deletedIds.get('appointment_photos') ?? new Set<string>()).has(photo.id))
      .map((photo) => photoToRow(appointment.id, photo)),
  )

  await upsertRows('clients', excludeDeleted('clients', data.clients, deletedIds).map(clientToRow))
  await upsertRows('payments', excludeDeleted('payments', data.payments, deletedIds).map(paymentToRow))
  await upsertRows('memberships', excludeDeleted('memberships', data.memberships ?? [], deletedIds).map(membershipToRow))
  await upsertRows('appointments', activeAppointments.map(appointmentToRow))
  await upsertRows('deals', excludeDeleted('deals', data.deals, deletedIds).map(dealToRow))
  await upsertRows('expenses', excludeDeleted('expenses', data.expenses, deletedIds).map(expenseToRow))
  await upsertRows('fixed_expenses', excludeDeleted('fixed_expenses', data.fixedExpenses, deletedIds).map(fixedExpenseToRow))
  await upsertRows('certificates', excludeDeleted('certificates', data.certificates ?? [], deletedIds).map(certificateToRow))
  await upsertRows('appointment_photos', appointmentPhotos)
  await upsertRows('guest_masters', excludeDeleted('guest_masters', data.guestMasters ?? [], deletedIds).map(guestMasterToRow))
  await upsertRows(
    'membership_redemptions',
    excludeDeleted('membership_redemptions', data.membershipRedemptions ?? [], deletedIds).map(membershipRedemptionToRow),
  )

  return (await loadNormalizedAppData()) ?? data
}

export async function setMembershipAppointmentStatusRemote(appointmentId: string, status: string) {
  if (!supabase) return null
  const { data, error } = await supabase.rpc('set_membership_appointment_status', {
    p_appointment_id: appointmentId,
    p_status: status,
  })
  if (error) throw error
  const result = data as { redemption?: CloudRow | null } | null
  return result?.redemption ? membershipRedemptionFromRow(result.redemption) : null
}

export async function softDeleteCloudRecords(records: SoftDeleteInput) {
  if (!supabase) return
  const client = supabase
  const deletedAt = new Date().toISOString()

  await Promise.all(
    Object.entries(records).map(async ([table, ids]) => {
      if (!ids?.length) return
      const { error } = await client.from(table).update({ deleted_at: deletedAt }).in('id', ids)
      if (error) throw error
    }),
  )
}
