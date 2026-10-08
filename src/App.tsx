import {
  AtSign,
  CalendarDays,
  ChevronRight,
  Download,
  Home,
  LogIn,
  LogOut,
  MessageCircle,
  MoreHorizontal,
  Phone,
  Plus,
  Receipt,
  Send,
  Wallet,
} from 'lucide-react'
import { Fragment, useMemo, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import './App.css'
import { MembershipForm, MembershipsPanel } from './components/Memberships'
import { seedData } from './data/seedData'
import {
  calculateFinanceMonth,
  calculateGuestSplit,
  expenseBelongsToTeacher,
  normalizeRatePercent,
} from './data/financeMetrics'
import {
  loadNormalizedAppData,
  loadStatisticsData,
  saveNormalizedAppData,
  setMembershipAppointmentStatusRemote,
  softDeleteCloudRecords,
} from './data/normalizedSupabase'
import {
  calculateMembershipRedemption,
  getMembershipStatus,
  membershipBalanceLabel,
  redemptionForAppointment,
  remainingMembershipObligation,
  validateMembershipRedemption,
} from './data/membershipLogic'
import { appDataStorageKey, supabase } from './data/supabaseClient'
import { downloadStatisticsReport } from './data/statisticsReport'
import type {
  AppData,
  Appointment,
  AppointmentStatus,
  Certificate,
  Deal,
  DealStatus,
  Expense,
  GuestMaster,
  Membership,
  MembershipKind,
  MembershipRedemption,
  Payment,
  PaymentMethod,
  ProductPhoto,
  Teacher,
} from './data/types'
import { useAuthProfile } from './hooks/useAuthProfile'
import { useSyncedAppData } from './hooks/useSyncedAppData'

type Tab = 'today' | 'calendar' | 'finance' | 'more'
type TodayQuickFilter = 'open' | 'overdue' | 'notify'

const appStorageKey = appDataStorageKey
const normalizedRemoteStore = {
  load: loadNormalizedAppData,
  save: saveNormalizedAppData,
}
const teachers: Teacher[] = ['Алина', 'Настя', 'Другое']
const dealStatuses: DealStatus[] = [
  'Бронь',
  'Посещение',
  'Изделие в работе',
  'Ожидание изделия',
  'Роспись после первого обжига',
  'Готово к выдаче',
  'Клиент оповещен',
  'Изделие выдано',
  'Сделка закрыта',
]
const visibleDealStatuses: DealStatus[] = [
  'Бронь',
  'Ожидание изделия',
  'Роспись после первого обжига',
  'Готово к выдаче',
  'Клиент оповещен',
  'Изделие выдано',
]
const quickStatusOptions: AppointmentStatus[] = visibleDealStatuses
const serviceFilters = [
  'Все',
  'Готовность',
]
const calendarStatusFilters: DealStatus[] = visibleDealStatuses
const expenseCategories = [
  'Аренда',
  'Коммуналка / электричество',
  'Уборка',
  'Реклама',
  'Материалы: глина, глазурь',
  'Упаковка',
  'Инструменты и оборудование',
  'Полиграфия и печать',
  'Налоги',
  'Прочее',
]

const todayIso = new Date().toISOString().slice(0, 10)
const firstCertificateNumber = 101
const nextManualCertificateNumber = 109
const photoBucket = 'deal-photos'
const maxAppointmentPhotos = 2
const maxPhotoDimension = 1600
const photoQuality = 0.76
const maxPhotoUploadSize = 1_800_000

function formatMoney(value: number) {
  return new Intl.NumberFormat('ru-RU').format(Math.round(value)) + ' THB'
}

function syncStatusLabel(status: ReturnType<typeof useSyncedAppData<AppData>>[2]['status']) {
  const labels = {
    error: 'ошибка',
    loading: 'загрузка',
    local: 'локально',
    saving: 'сохраняется',
    synced: 'сохранено',
  } as const

  return labels[status]
}

function formatDate(value: string) {
  if (!value) return 'Без даты'
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'short',
  }).format(new Date(`${value}T00:00:00`))
}

function formatDateLong(value: string) {
  if (!value) return 'Без даты'
  return new Intl.DateTimeFormat('ru-RU', {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
  }).format(new Date(`${value}T00:00:00`))
}

function formatWeekday(value: string) {
  return new Intl.DateTimeFormat('ru-RU', {
    weekday: 'short',
  }).format(new Date(`${value}T00:00:00`))
}

function formatDayNumber(value: string) {
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
  }).format(new Date(`${value}T00:00:00`))
}

function monthLabel(value: string) {
  return new Intl.DateTimeFormat('ru-RU', {
    month: 'long',
    year: 'numeric',
  }).format(new Date(`${value}-01T00:00:00`))
}

function daysBetween(start: string, end = todayIso) {
  if (!start) return 0
  const startDate = new Date(`${start}T00:00:00`).getTime()
  const endDate = new Date(`${end}T00:00:00`).getTime()
  return Math.floor((endDate - startDate) / 86_400_000)
}

function addDays(date: string, days: number) {
  const [year, month, day] = date.split('-').map(Number)
  const parsed = new Date(Date.UTC(year, month - 1, day))
  parsed.setUTCDate(parsed.getUTCDate() + days)
  return `${parsed.getUTCFullYear()}-${String(parsed.getUTCMonth() + 1).padStart(2, '0')}-${String(parsed.getUTCDate()).padStart(2, '0')}`
}

function startOfWeekMonday(date: string) {
  const weekday = new Date(`${date}T00:00:00`).getDay()
  const daysFromMonday = weekday === 0 ? 6 : weekday - 1
  return addDays(date, -daysFromMonday)
}

function addMonths(date: string, months: number) {
  const [year, month, day] = date.split('-').map(Number)
  const parsed = new Date(Date.UTC(year, month - 1, day))
  parsed.setUTCMonth(parsed.getUTCMonth() + months)
  return `${parsed.getUTCFullYear()}-${String(parsed.getUTCMonth() + 1).padStart(2, '0')}-${String(parsed.getUTCDate()).padStart(2, '0')}`
}

function statusClass(status: string) {
  if (status.includes('закры') || status.includes('выдан')) return 'success'
  if (status.includes('оповещ') || status.includes('готов')) return 'info'
  if (status.includes('ожидан') || status.includes('работ') || status.includes('роспись')) return 'waiting'
  return 'neutral'
}

function editableDealStatus(status?: AppointmentStatus | DealStatus) {
  return status && visibleDealStatuses.includes(status as DealStatus) ? status : 'Бронь'
}

function nextStepFor(status: DealStatus) {
  const map: Record<DealStatus, string> = {
    Бронь: 'Провести занятие',
    Посещение: 'Передать изделие в работу',
    'Изделие в работе': 'Дождаться готовности',
    'Ожидание изделия': 'Проверить готовность',
    'Роспись после первого обжига': 'Дождаться росписи',
    'Готово к выдаче': 'Оповестить клиента',
    'Клиент оповещен': 'Выдать изделие',
    'Изделие выдано': 'Закрыть сделку',
    'Сделка закрыта': 'Закрыто',
  }
  return map[status]
}

function toDealStatus(status: AppointmentStatus): DealStatus {
  if (dealStatuses.includes(status as DealStatus)) return status as DealStatus
  if (status === 'Проведен') return 'Посещение'
  if (status === 'Закрыт') return 'Сделка закрыта'
  return 'Бронь'
}

function dealForAppointment(appointment: Appointment, deals: Deal[]) {
  return deals.find((deal) => deal.appointmentId === appointment.id || deal.id === appointment.dealId)
}

function appointmentForDeal(deal: Deal, appointments: Appointment[]) {
  return appointments.find((appointment) => appointment.id === deal.appointmentId || appointment.dealId === deal.id)
}

function isOpenDeal(deal: Deal) {
  return !isFinalReadinessStatus(deal.status)
}

function isFinalReadinessStatus(status?: AppointmentStatus | DealStatus) {
  return status === 'Изделие выдано' || status === 'Сделка закрыта' || status === 'Закрыт'
}

function isOpenDealWithAppointment(deal: Deal, appointment?: Appointment) {
  return isOpenDeal(deal) && !isFinalReadinessStatus(appointment?.status)
}

function daysUntil(date: string) {
  return daysBetween(todayIso, date)
}

function needsReadinessAttention(deal?: Deal, appointment?: Appointment) {
  if (!deal || !isOpenDealWithAppointment(deal, appointment) || !deal.expectedReadyDate) return false
  if (isFinalReadinessStatus(deal.status) || isFinalReadinessStatus(appointment?.status)) return false

  const readinessDelta = daysUntil(deal.expectedReadyDate)
  const dueSoonOrFreshOverdue = readinessDelta <= 3 && readinessDelta >= -5
  const manuallyReady =
    (deal.status === 'Готово к выдаче' || deal.status === 'Клиент оповещен') && readinessDelta >= -5

  return dueSoonOrFreshOverdue || manuallyReady
}

function needsReadinessAttentionForAppointment(appointment: Appointment, deals: Deal[]) {
  if (isCertificateAppointment(appointment)) return false
  return needsReadinessAttention(dealForAppointment(appointment, deals), appointment)
}

function isCertificateAppointment(appointment: Appointment) {
  return appointment.serviceType === 'Сертификаты'
}

function isCertificatePayment(payment: Payment) {
  return payment.type === 'Сертификаты' || payment.service === 'Сертификат' || payment.status === 'Покупка сертификата'
}

function getVisibleAppointments(appointments: Appointment[]) {
  return appointments.filter((appointment) => !isCertificateAppointment(appointment))
}

function appointmentCreatesDeal(serviceType: string) {
  return serviceType !== 'Коворкинг' && serviceType !== 'Сертификаты'
}

function certificateNumberFromPayment(_payment: Payment, index: number) {
  return String(firstCertificateNumber + index)
}

function getCertificates(data: AppData) {
  const savedCertificates = data.certificates ?? []
  const savedByPaymentId = new Map(savedCertificates.map((certificate) => [certificate.purchasePaymentId, certificate]))
  const savedById = new Map(savedCertificates.map((certificate) => [certificate.id, certificate]))
  const purchasePayments = data.payments
    .filter(isCertificatePayment)
    .sort((a, b) => `${a.date}${a.id}`.localeCompare(`${b.date}${b.id}`))
  const derived = purchasePayments.map((payment, index): Certificate => {
    const id = `certificate-${payment.id}`
    const saved = savedByPaymentId.get(payment.id) ?? savedById.get(id)
    return {
      id,
      number: saved?.number ?? certificateNumberFromPayment(payment, index),
      purchasePaymentId: payment.id,
      clientName: payment.clientName,
      purchaseDate: payment.date,
      expiresAt: saved?.expiresAt ?? addMonths(payment.date, 6),
      amount: payment.amount,
      teacher: saved?.teacher,
      usedAt: saved?.usedAt,
      comment: saved?.comment ?? payment.comment,
    }
  })

  const manual = savedCertificates.filter((certificate) => !certificate.purchasePaymentId)
  return [...derived, ...manual].sort((a, b) => {
    if (Boolean(a.usedAt) !== Boolean(b.usedAt)) return a.usedAt ? 1 : -1
    return b.purchaseDate.localeCompare(a.purchaseDate)
  })
}

function getNextCertificateNumber(certificates: Certificate[]) {
  const numericNumbers = certificates.map((certificate) => Number(certificate.number)).filter(Number.isFinite)
  return String(Math.max(nextManualCertificateNumber - 1, ...numericNumbers) + 1)
}

function createPaymentFromAppointment(appointment: Appointment, existingPayment?: Payment): Payment {
  return {
    id: existingPayment?.id ?? `payment-${Date.now()}`,
    appointmentId: appointment.id,
    date: appointment.date,
    month: appointment.date.slice(0, 7),
    type: appointment.serviceType,
    clientName: appointment.clientName,
    status: appointment.status,
    amount: appointment.amount,
    teacher: appointment.teacher,
    sourceTeacher: appointment.sourceTeacher,
    service: appointment.item,
    cash: appointment.amount > 0,
    source: existingPayment?.source ?? 'Ручной ввод',
    comment: appointment.comment,
  }
}

function syncAppointmentPayment(payments: Payment[], appointment: Appointment) {
  const paymentIndex = payments.findIndex((payment) => payment.appointmentId === appointment.id)
  if (appointment.paymentMethod === 'membership' || !appointment.paid || appointment.amount <= 0) {
    return payments.filter((payment) => payment.appointmentId !== appointment.id)
  }

  const syncedPayment = createPaymentFromAppointment(appointment, paymentIndex >= 0 ? payments[paymentIndex] : undefined)
  return paymentIndex >= 0
    ? payments.map((payment, index) => (index === paymentIndex ? syncedPayment : payment))
    : [syncedPayment, ...payments]
}

function imageElementFromFile(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    const objectUrl = URL.createObjectURL(file)
    image.onload = () => {
      URL.revokeObjectURL(objectUrl)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error('Не удалось прочитать фото'))
    }
    image.src = objectUrl
  })
}

async function compressImage(file: File) {
  const image = await imageElementFromFile(file)
  let dimension = maxPhotoDimension
  let quality = photoQuality
  let blob: Blob | null = null
  let width = image.naturalWidth
  let height = image.naturalHeight

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const scale = Math.min(1, dimension / Math.max(image.naturalWidth, image.naturalHeight))
    width = Math.max(1, Math.round(image.naturalWidth * scale))
    height = Math.max(1, Math.round(image.naturalHeight * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Не удалось подготовить фото')

    context.fillStyle = '#fff'
    context.fillRect(0, 0, width, height)
    context.drawImage(image, 0, 0, width, height)

    blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((result) => {
        if (result) resolve(result)
        else reject(new Error('Не удалось сжать фото'))
      }, 'image/jpeg', quality)
    })

    if (blob.size <= maxPhotoUploadSize) break
    dimension = Math.round(dimension * 0.82)
    quality = Math.max(0.52, quality - 0.08)
  }

  if (!blob) throw new Error('Не удалось сжать фото')

  return {
    blob,
    height,
    width,
  }
}

function safeFilePart(value: string) {
  const safeName = value
    .toLowerCase()
    .replace(/\.[^/.]+$/, '')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32)

  return safeName || 'photo'
}

function normalizePhoneLink(value?: string) {
  const digits = (value ?? '').replace(/[^\d]/g, '')
  return digits ? `tel:+${digits}` : undefined
}

function normalizeWhatsAppLink(value?: string) {
  const digits = (value ?? '').replace(/[^\d]/g, '')
  return digits ? `https://wa.me/${digits}` : undefined
}

function normalizeTelegramLink(value?: string) {
  const cleanValue = (value ?? '').trim()
  if (!cleanValue) return undefined
  if (/^https?:\/\//i.test(cleanValue)) return cleanValue
  const username = cleanValue.replace(/^@/, '').replace(/^t\.me\//i, '')
  return username ? `https://t.me/${username}` : undefined
}

function normalizeInstagramLink(value?: string) {
  const cleanValue = (value ?? '').trim()
  if (!cleanValue) return undefined
  if (/^https?:\/\//i.test(cleanValue)) return cleanValue
  const normalized = cleanValue
    .replace(/^@/, '')
    .replace(/^instagram\.com\//i, '')
    .replace(/^www\.instagram\.com\//i, '')
  return normalized ? `https://instagram.com/${normalized}` : undefined
}

function closeHistoricalDeals(data: AppData) {
  const cutoff = '2026-05-01'
  const closedAppointmentIds = new Set(
    data.deals
      .filter((deal) => deal.visitDate < cutoff && isOpenDeal(deal))
      .map((deal) => deal.appointmentId),
  )

  if (!closedAppointmentIds.size) return data

  return {
    ...data,
    appointments: data.appointments.map((appointment) =>
      closedAppointmentIds.has(appointment.id) ? { ...appointment, status: 'Сделка закрыта' } : appointment,
    ),
    deals: data.deals.map((deal) =>
      closedAppointmentIds.has(deal.appointmentId)
        ? {
            ...deal,
            status: 'Сделка закрыта',
            nextStep: 'Закрыто',
            history: [
              ...deal.history,
              { date: todayIso, status: 'Сделка закрыта', note: 'Закрыто при локальной корректировке до мая' },
            ],
          }
        : deal,
    ),
    payments: data.payments.map((payment) =>
      payment.appointmentId && closedAppointmentIds.has(payment.appointmentId)
        ? { ...payment, status: 'Сделка закрыта' }
        : payment,
    ),
  } satisfies AppData
}

function shouldKeepLocalAppData(localData: AppData, remoteData: AppData) {
  const localPhotos = localData.appointments.reduce((sum, appointment) => sum + (appointment.photos?.length ?? 0), 0)
  const remotePhotos = remoteData.appointments.reduce((sum, appointment) => sum + (appointment.photos?.length ?? 0), 0)

  return (
    localPhotos > remotePhotos ||
    (localData.certificates?.length ?? 0) > (remoteData.certificates?.length ?? 0) ||
    (localData.memberships?.length ?? 0) > (remoteData.memberships?.length ?? 0) ||
    (localData.membershipRedemptions?.length ?? 0) > (remoteData.membershipRedemptions?.length ?? 0)
  )
}

function mergeById<T extends { id: string }>(
  remoteItems: T[] = [],
  localItems: T[] = [],
  mergeSame?: (remoteItem: T, localItem: T) => T,
) {
  const merged = new Map(remoteItems.map((item) => [item.id, item]))

  localItems.forEach((localItem) => {
    const remoteItem = merged.get(localItem.id)
    merged.set(localItem.id, remoteItem && mergeSame ? mergeSame(remoteItem, localItem) : remoteItem ?? localItem)
  })

  return [...merged.values()]
}

function mergeUniqueBy<T>(items: T[], getKey: (item: T) => string) {
  const merged = new Map<string, T>()
  items.forEach((item) => merged.set(getKey(item), item))
  return [...merged.values()]
}

function preferRicherRecord<T extends { id: string }>(remoteItem: T, localItem: T) {
  return JSON.stringify(localItem).length > JSON.stringify(remoteItem).length ? localItem : remoteItem
}

function mergeAppointment(remoteAppointment: Appointment, localAppointment: Appointment) {
  const base = preferRicherRecord(remoteAppointment, localAppointment)
  const photos = mergeById(remoteAppointment.photos ?? [], localAppointment.photos ?? [])
  return photos.length ? { ...base, photos } : base
}

function mergeDeal(remoteDeal: Deal, localDeal: Deal) {
  const base = preferRicherRecord(remoteDeal, localDeal)
  const history = mergeUniqueBy(
    [...(remoteDeal.history ?? []), ...(localDeal.history ?? [])],
    (item) => `${item.date}-${item.status}-${item.note ?? ''}`,
  )
  return { ...base, history }
}

function mergeAppData(localData: AppData, remoteData: AppData) {
  return {
    ...remoteData,
    clients: mergeById(remoteData.clients, localData.clients),
    appointments: mergeById(remoteData.appointments, localData.appointments, mergeAppointment),
    deals: mergeById(remoteData.deals, localData.deals, mergeDeal),
    payments: mergeById(remoteData.payments, localData.payments),
    expenses: mergeById(remoteData.expenses, localData.expenses),
    fixedExpenses: mergeById(remoteData.fixedExpenses, localData.fixedExpenses),
    certificates: mergeById(remoteData.certificates ?? [], localData.certificates ?? []),
    guestMasters: mergeById(remoteData.guestMasters ?? [], localData.guestMasters ?? []),
    memberships: mergeById(remoteData.memberships ?? [], localData.memberships ?? []),
    membershipRedemptions: mergeById(
      remoteData.membershipRedemptions ?? [],
      localData.membershipRedemptions ?? [],
    ),
    staff: mergeUniqueBy([...remoteData.staff, ...localData.staff], (item) => item),
    serviceTypes: mergeUniqueBy([...remoteData.serviceTypes, ...localData.serviceTypes], (item) => item),
  } satisfies AppData
}

function App() {
  const auth = useAuthProfile()
  const [data, setData, syncMeta] = useSyncedAppData<AppData>(appStorageKey, closeHistoricalDeals(seedData), {
    canSaveRemote: auth.canEdit,
    mergeRemote: mergeAppData,
    remoteStore: normalizedRemoteStore,
    shouldKeepLocal: shouldKeepLocalAppData,
  })
  const [activeTab, setActiveTab] = useState<Tab>('today')
  const [showAppointmentForm, setShowAppointmentForm] = useState(false)
  const [showExpenseForm, setShowExpenseForm] = useState(false)
  const [showCertificateForm, setShowCertificateForm] = useState(false)
  const [showMembershipForm, setShowMembershipForm] = useState(false)
  const [showGuestMasterForm, setShowGuestMasterForm] = useState(false)
  const [editingAppointment, setEditingAppointment] = useState<Appointment | null>(null)
  const [editingCertificate, setEditingCertificate] = useState<Certificate | null>(null)
  const [editingMembership, setEditingMembership] = useState<Membership | null>(null)
  const [editingGuestMaster, setEditingGuestMaster] = useState<GuestMaster | null>(null)
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null)
  const [photoUploadState, setPhotoUploadState] = useState<Record<string, string>>({})
  const [membershipActionError, setMembershipActionError] = useState<string>()
  const [isExportingReport, setIsExportingReport] = useState(false)
  const [reportError, setReportError] = useState<string>()
  const [calendarFilter, setCalendarFilter] = useState('Все')
  const monthOptions = useMemo(() => getMonthOptions(data), [data])
  const [selectedMonth, setSelectedMonth] = useState(
    monthOptions.includes(todayIso.slice(0, 7)) ? todayIso.slice(0, 7) : monthOptions.at(-1) ?? todayIso.slice(0, 7),
  )

  const stats = useMemo(() => getDashboardStats(data, selectedMonth), [data, selectedMonth])
  const exportReport = async () => {
    if (!auth.isKnownStaff || !supabase || isExportingReport) return
    setIsExportingReport(true)
    setReportError(undefined)
    try {
      await downloadStatisticsReport(await loadStatisticsData())
    } catch (error) {
      setReportError(error instanceof Error ? error.message : 'Не удалось скачать отчёт. Повторите попытку.')
    } finally {
      setIsExportingReport(false)
    }
  }
  const todayAppointments = useMemo(
    () =>
      getVisibleAppointments(data.appointments)
        .filter((appointment) => appointment.date === todayIso)
        .sort((a, b) => a.time.localeCompare(b.time)),
    [data.appointments],
  )
  const upcomingAppointments = useMemo(
    () =>
      getVisibleAppointments(data.appointments)
        .filter((appointment) => appointment.date >= todayIso)
        .sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`))
        .slice(0, 6),
    [data.appointments],
  )

  const addAppointment = (formData: FormData) => {
    if (!auth.canEdit) return
    const parsed = parseAppointmentForm(formData, data.guestMasters ?? [], data.memberships ?? [])
    const clientId = parsed.membership?.clientId ?? `client-${crypto.randomUUID()}`
    const appointmentId = `appointment-${crypto.randomUUID()}`
    const appointmentSnapshot = parsed.membership
      ? { ...parsed.appointment, status: 'Бронь' as const, paid: false, cash: false }
      : parsed.appointment
    const newAppointment: Appointment = {
      id: appointmentId,
      clientId,
      ...appointmentSnapshot,
    }

    const newPayment: Payment | null =
      newAppointment.paymentMethod !== 'membership' && newAppointment.paid && newAppointment.amount > 0
        ? createPaymentFromAppointment(newAppointment)
        : null

    let deal: Deal | null = null
    if (parsed.withItem) {
      const dealStatus: DealStatus = parsed.membership ? 'Бронь' : toDealStatus(newAppointment.status)
      deal = {
        id: `deal-${crypto.randomUUID()}`,
        appointmentId,
        clientId,
        clientName: newAppointment.clientName,
        visitDate: newAppointment.date,
        teacher: newAppointment.teacher,
        status: dealStatus,
        expectedReadyDate: addDays(newAppointment.date, 21),
        nextStep: nextStepFor(dealStatus),
        amount: newAppointment.amount,
        item: newAppointment.item,
        comment: newAppointment.comment,
        history: [{ date: todayIso, status: dealStatus, note: 'Создано вручную' }],
      }
      newAppointment.dealId = deal.id
    }

    setData((current) => ({
      ...current,
      clients: current.clients.some((client) => client.id === clientId)
        ? current.clients.map((client) => client.id === clientId
            ? { ...client, name: newAppointment.clientName, ...parsed.contact }
            : client)
        : [...current.clients, { id: clientId, name: newAppointment.clientName, ...parsed.contact }],
      appointments: [newAppointment, ...current.appointments],
      payments: newPayment ? [newPayment, ...current.payments] : current.payments,
      deals: deal ? [deal, ...current.deals] : current.deals,
    }))
    setShowAppointmentForm(false)
    setActiveTab('today')
  }

  const editAppointment = (appointmentId: string, formData: FormData) => {
    if (!auth.canEdit) return
    const parsed = parseAppointmentForm(formData, data.guestMasters ?? [], data.memberships ?? [])
    const currentAppointment = data.appointments.find((appointment) => appointment.id === appointmentId)
    if (!currentAppointment) return
    const hasActiveRedemption = Boolean(redemptionForAppointment(appointmentId, data.membershipRedemptions ?? []))
    const membershipFields = hasActiveRedemption
      ? {
          amount: currentAppointment.amount,
          paymentMethod: currentAppointment.paymentMethod,
          membershipId: currentAppointment.membershipId,
          membershipName: currentAppointment.membershipName,
          membershipChargeAmount: currentAppointment.membershipChargeAmount,
        }
      : {}
    const clientId = hasActiveRedemption
      ? currentAppointment.clientId
      : parsed.membership?.clientId ?? currentAppointment.clientId
    const nextAppointment: Appointment = {
      ...currentAppointment,
      ...parsed.appointment,
      ...membershipFields,
      clientId,
      status: currentAppointment.paymentMethod === 'membership' || parsed.appointment.paymentMethod === 'membership'
        ? currentAppointment.status
        : parsed.appointment.status,
    }
    nextAppointment.paid = nextAppointment.status !== 'Бронь'
    nextAppointment.cash = nextAppointment.paymentMethod !== 'membership' && nextAppointment.paid && nextAppointment.amount > 0

    let nextDealId = currentAppointment.dealId
    setData((current) => {
      const existingDeal = nextDealId
        ? current.deals.find((deal) => deal.id === nextDealId)
        : undefined
      let nextDeals = current.deals

      if (parsed.withItem) {
        const dealStatus = dealStatuses.includes(nextAppointment.status as DealStatus)
          ? (nextAppointment.status as DealStatus)
          : existingDeal?.status ?? 'Бронь'

        if (existingDeal) {
          nextDeals = current.deals.map((deal) =>
            deal.id === existingDeal.id
              ? {
                  ...deal,
                  clientId: nextAppointment.clientId,
                  clientName: nextAppointment.clientName,
                  visitDate: nextAppointment.date,
                  teacher: nextAppointment.teacher,
                  status: dealStatus,
                  expectedReadyDate: addDays(nextAppointment.date, 21),
                  nextStep: nextStepFor(dealStatus),
                  amount: nextAppointment.amount,
                  item: nextAppointment.item,
                  comment: nextAppointment.comment,
                  history: [...deal.history, { date: todayIso, status: dealStatus, note: 'Запись отредактирована' }],
                }
              : deal,
          )
        } else {
          nextDealId = `deal-${crypto.randomUUID()}`
          nextDeals = [
            {
              id: nextDealId,
              appointmentId: nextAppointment.id,
              clientId: nextAppointment.clientId,
              clientName: nextAppointment.clientName,
              visitDate: nextAppointment.date,
              teacher: nextAppointment.teacher,
              status: dealStatus,
              expectedReadyDate: addDays(nextAppointment.date, 21),
              nextStep: nextStepFor(dealStatus),
              amount: nextAppointment.amount,
              item: nextAppointment.item,
              comment: nextAppointment.comment,
              history: [{ date: todayIso, status: dealStatus, note: 'Сделка создана при редактировании' }],
            },
            ...current.deals,
          ]
        }
      } else if (nextDealId) {
        nextDeals = current.deals.filter((deal) => deal.id !== nextDealId)
        nextDealId = undefined
      }

      const nextPayments = syncAppointmentPayment(current.payments, nextAppointment)

      return {
        ...current,
        clients: current.clients.map((client) =>
          client.id === nextAppointment.clientId
            ? { ...client, name: nextAppointment.clientName, ...parsed.contact }
            : client,
        ),
        appointments: current.appointments.map((appointment) =>
          appointment.id === nextAppointment.id ? { ...nextAppointment, dealId: nextDealId } : appointment,
        ),
        payments: nextPayments,
        deals: nextDeals,
      }
    })
    setEditingAppointment(null)
  }

  const deleteAppointment = async (appointmentId: string) => {
    if (!auth.canEdit) return
    const appointment = data.appointments.find((item) => item.id === appointmentId)
    if (!appointment) return
    setMembershipActionError(undefined)

    try {
      if (appointment.paymentMethod === 'membership' && supabase) {
        await setMembershipAppointmentStatusRemote(appointmentId, 'Бронь')
      }
      await softDeleteCloudRecords({
        appointments: [appointmentId],
        deals: data.deals.filter((deal) => deal.appointmentId === appointmentId).map((deal) => deal.id),
        payments: data.payments.filter((payment) => payment.appointmentId === appointmentId).map((payment) => payment.id),
        appointment_photos: (appointment.photos ?? []).map((photo) => photo.id),
        membership_redemptions: (data.membershipRedemptions ?? [])
          .filter((redemption) => redemption.appointmentId === appointmentId)
          .map((redemption) => redemption.id),
      })
    } catch (error) {
      setMembershipActionError(error instanceof Error ? error.message : 'Не удалось удалить запись.')
      return
    }

    setData((current) => ({
      ...current,
      appointments: current.appointments.filter((item) => item.id !== appointmentId),
      payments: current.payments.filter((payment) => payment.appointmentId !== appointmentId),
      deals: current.deals.filter((deal) => deal.appointmentId !== appointmentId),
      membershipRedemptions: (current.membershipRedemptions ?? []).filter(
        (redemption) => redemption.appointmentId !== appointmentId,
      ),
    }))
    setEditingAppointment(null)
  }

  const uploadAppointmentPhotos = async (appointmentId: string, files: FileList | File[]) => {
    if (!auth.canEdit) return
    if (!supabase) {
      setPhotoUploadState((current) => ({
        ...current,
        [appointmentId]: 'Хранилище фото доступно только в онлайн-версии.',
      }))
      return
    }

    const appointment = data.appointments.find((item) => item.id === appointmentId)
    if (!appointment) return

    const currentPhotos = appointment.photos ?? []
    const availableSlots = Math.max(0, maxAppointmentPhotos - currentPhotos.length)
    const selectedFiles = Array.from(files).slice(0, availableSlots)
    if (!selectedFiles.length) {
      setPhotoUploadState((current) => ({
        ...current,
        [appointmentId]: 'Можно добавить максимум 2 фото.',
      }))
      return
    }

    setPhotoUploadState((current) => ({ ...current, [appointmentId]: 'Сжимаю и загружаю фото...' }))

    try {
      const uploadedPhotos: ProductPhoto[] = []
      for (const file of selectedFiles) {
        const compressed = await compressImage(file)
        const photoId = crypto.randomUUID()
        const path = `appointments/${appointmentId}/${Date.now()}-${photoId}-${safeFilePart(file.name)}.jpg`
        const uploadFile = new File([compressed.blob], path.split('/').at(-1) ?? 'photo.jpg', { type: 'image/jpeg' })
        const { error: uploadError } = await supabase.storage
          .from(photoBucket)
          .upload(path, uploadFile, {
            cacheControl: '31536000',
            upsert: false,
          })

        if (uploadError) throw uploadError

        const { data: publicUrl } = supabase.storage.from(photoBucket).getPublicUrl(path)
        uploadedPhotos.push({
          id: photoId,
          path,
          url: publicUrl.publicUrl,
          uploadedAt: new Date().toISOString(),
          width: compressed.width,
          height: compressed.height,
          size: uploadFile.size,
        })
      }

      const nextPhotos = [...currentPhotos, ...uploadedPhotos].slice(0, maxAppointmentPhotos)
      setData((current) => ({
        ...current,
        appointments: current.appointments.map((item) =>
          item.id === appointmentId ? { ...item, photos: nextPhotos } : item,
        ),
      }))
      setEditingAppointment((current) =>
        current?.id === appointmentId ? { ...current, photos: nextPhotos } : current,
      )
      setPhotoUploadState((current) => ({ ...current, [appointmentId]: 'Фото загружены.' }))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Не удалось загрузить фото'
      setPhotoUploadState((current) => ({ ...current, [appointmentId]: message }))
    }
  }

  const deleteAppointmentPhoto = async (appointmentId: string, photoId: string) => {
    if (!auth.canEdit) return
    const appointment = data.appointments.find((item) => item.id === appointmentId)
    const photo = appointment?.photos?.find((item) => item.id === photoId)
    if (!appointment || !photo) return

    if (supabase) {
      setPhotoUploadState((current) => ({ ...current, [appointmentId]: 'Удаляю фото...' }))
      const { error } = await supabase.storage.from(photoBucket).remove([photo.path])
      if (error) {
        setPhotoUploadState((current) => ({ ...current, [appointmentId]: error.message }))
        return
      }
    }
    void softDeleteCloudRecords({ appointment_photos: [photoId] })

    const nextPhotos = (appointment.photos ?? []).filter((item) => item.id !== photoId)
    setData((current) => ({
      ...current,
      appointments: current.appointments.map((item) =>
        item.id === appointmentId ? { ...item, photos: nextPhotos } : item,
      ),
    }))
    setEditingAppointment((current) =>
      current?.id === appointmentId ? { ...current, photos: nextPhotos } : current,
    )
    setPhotoUploadState((current) => ({ ...current, [appointmentId]: 'Фото удалено.' }))
  }

  const addExpense = (formData: FormData) => {
    if (!auth.canEdit) return
    const date = String(formData.get('date') || todayIso)
    const expense: Expense = {
      id: `expense-${Date.now()}`,
      date,
      month: date.slice(0, 7),
      paidBy: String(formData.get('paidBy') || 'Студия'),
      category: String(formData.get('category') || 'Прочее'),
      subcategory: '',
      description: String(formData.get('description') || ''),
      amount: Number(formData.get('amount') || 0),
      type: 'Факт',
      source: 'Ручной ввод',
      comment: String(formData.get('comment') || ''),
    }
    setData((current) => ({ ...current, expenses: [expense, ...current.expenses] }))
    setShowExpenseForm(false)
    setActiveTab('finance')
    setSelectedMonth(expense.month)
  }

  const editExpense = (expenseId: string, formData: FormData) => {
    if (!auth.canEdit) return
    const date = String(formData.get('date') || todayIso)
    const nextExpense: Expense = {
      id: expenseId,
      date,
      month: date.slice(0, 7),
      paidBy: String(formData.get('paidBy') || 'Студия'),
      category: String(formData.get('category') || 'Прочее'),
      subcategory: '',
      description: String(formData.get('description') || ''),
      amount: Number(formData.get('amount') || 0),
      type: editingExpense?.type ?? 'Факт',
      source: editingExpense?.source ?? 'Ручной ввод',
      comment: String(formData.get('comment') || ''),
    }

    setData((current) => ({
      ...current,
      expenses: current.expenses.map((expense) => (expense.id === expenseId ? nextExpense : expense)),
    }))
    setEditingExpense(null)
    setActiveTab('finance')
    setSelectedMonth(nextExpense.month)
  }

  const deleteExpense = (expenseId: string) => {
    if (!auth.canEdit) return
    void softDeleteCloudRecords({ expenses: [expenseId] })
    setData((current) => ({
      ...current,
      expenses: current.expenses.filter((expense) => expense.id !== expenseId),
    }))
    setEditingExpense(null)
  }

  const updateAppointmentStatus = async (appointmentId: string, status: AppointmentStatus) => {
    if (!auth.canEdit) return
    const appointment = data.appointments.find((item) => item.id === appointmentId)
    if (!appointment) return
    setMembershipActionError(undefined)
    let nextRedemption: MembershipRedemption | null | undefined

    if (appointment.paymentMethod === 'membership') {
      const membership = (data.memberships ?? []).find((item) => item.id === appointment.membershipId)
      if (!membership) {
        setMembershipActionError('Привязанный абонемент не найден. Откройте запись и выберите действующий абонемент.')
        return
      }
      const currentRedemptions = data.membershipRedemptions ?? []
      const currentRedemption = redemptionForAppointment(appointmentId, currentRedemptions)
      if (status !== 'Бронь' && !currentRedemption) {
        const validationError = validateMembershipRedemption(membership, appointment, currentRedemptions)
        if (validationError) {
          setMembershipActionError(validationError)
          return
        }
      }

      try {
        if (supabase) {
          try {
            nextRedemption = await setMembershipAppointmentStatusRemote(appointmentId, status)
          } catch (remoteError) {
            const message = remoteError instanceof Error ? remoteError.message : String(remoteError)
            if (!message.includes('Запись не найдена')) throw remoteError
            await saveNormalizedAppData(data)
            nextRedemption = await setMembershipAppointmentStatusRemote(appointmentId, status)
          }
        } else {
          nextRedemption = status === 'Бронь'
            ? null
            : currentRedemption ?? calculateMembershipRedemption(
                membership,
                appointment,
                currentRedemptions,
                currentRedemptions.find((item) => item.appointmentId === appointmentId)?.id,
              )
        }
      } catch (error) {
        setMembershipActionError(error instanceof Error ? error.message : 'Не удалось списать абонемент.')
        return
      }
    }

    setData((current) => {
      const currentAppointment = current.appointments.find((item) => item.id === appointmentId)
      const isMembership = currentAppointment?.paymentMethod === 'membership'
      const nextAppointment = currentAppointment
        ? {
            ...currentAppointment,
            status,
            paid: status !== 'Бронь',
            cash: !isMembership && status !== 'Бронь' && currentAppointment.amount > 0,
          }
        : undefined
      const dealStatus = toDealStatus(status)
      let nextMembershipRedemptions = current.membershipRedemptions ?? []

      if (isMembership) {
        if (status === 'Бронь') {
          nextMembershipRedemptions = nextMembershipRedemptions.map((redemption) =>
            redemption.appointmentId === appointmentId && !redemption.reversedAt
              ? { ...redemption, reversedAt: new Date().toISOString() }
              : redemption,
          )
        } else if (nextRedemption) {
          nextMembershipRedemptions = nextMembershipRedemptions.some(
            (redemption) => redemption.appointmentId === appointmentId,
          )
            ? nextMembershipRedemptions.map((redemption) =>
                redemption.appointmentId === appointmentId ? nextRedemption! : redemption,
              )
            : [nextRedemption, ...nextMembershipRedemptions]
        }
      }

      return {
        ...current,
        appointments: current.appointments.map((item) =>
          item.id === appointmentId && nextAppointment ? nextAppointment : item,
        ),
        payments: nextAppointment ? syncAppointmentPayment(current.payments, nextAppointment) : current.payments,
        membershipRedemptions: nextMembershipRedemptions,
        deals: current.deals.map((deal) =>
          deal.appointmentId === appointmentId || deal.id === currentAppointment?.dealId
            ? {
                ...deal,
                status: dealStatus,
                nextStep: nextStepFor(dealStatus),
                history: [...deal.history, { date: todayIso, status: dealStatus, note: 'Статус изменен в календаре' }],
              }
            : deal,
        ),
      }
    })
  }

  const addCertificate = (formData: FormData) => {
    if (!auth.canEdit) return
    const certificates = getCertificates(data)
    const purchaseDate = String(formData.get('purchaseDate') || todayIso)
    const number = String(formData.get('number') || getNextCertificateNumber(certificates)).trim()
    const clientName = String(formData.get('clientName') || '').trim() || 'Не указан'
    const amount = Number(formData.get('amount') || 0)
    const teacher = String(formData.get('teacher') || 'Другое') as Teacher
    const comment = String(formData.get('comment') || '').trim()
    const paymentId = `payment-certificate-${Date.now()}`
    const certificate: Certificate = {
      id: `certificate-${paymentId}`,
      number,
      purchasePaymentId: paymentId,
      clientName,
      purchaseDate,
      expiresAt: addMonths(purchaseDate, 6),
      amount,
      teacher,
      usedAt: formData.get('used') === 'on' ? todayIso : undefined,
      comment,
    }
    const payment: Payment = {
      id: paymentId,
      date: purchaseDate,
      month: purchaseDate.slice(0, 7),
      type: 'Сертификаты',
      clientName,
      status: 'Покупка сертификата',
      amount,
      teacher: 'Другое',
      service: `Сертификат ${number}`,
      cash: amount > 0,
      source: 'Ручной ввод',
      comment,
    }

    setData((current) => ({
      ...current,
      certificates: [certificate, ...(current.certificates ?? [])],
      payments: [payment, ...current.payments],
    }))
    setShowCertificateForm(false)
    setActiveTab('more')
  }

  const editCertificate = (certificateId: string, formData: FormData) => {
    if (!auth.canEdit) return
    const purchaseDate = String(formData.get('purchaseDate') || todayIso)
    const number = String(formData.get('number') || '').trim()
    const clientName = String(formData.get('clientName') || '').trim() || 'Не указан'
    const amount = Number(formData.get('amount') || 0)
    const teacher = String(formData.get('teacher') || 'Другое') as Teacher
    const comment = String(formData.get('comment') || '').trim()
    const usedAt = formData.get('used') === 'on' ? (editingCertificate?.usedAt ?? todayIso) : undefined

    setData((current) => {
      const currentCertificate = getCertificates(current).find((certificate) => certificate.id === certificateId)
      if (!currentCertificate) return current

      const nextCertificate: Certificate = {
        ...currentCertificate,
        number: number || currentCertificate.number,
        clientName,
        purchaseDate,
        expiresAt: addMonths(purchaseDate, 6),
        amount,
        teacher,
        usedAt,
        comment,
      }
      const savedCertificates = current.certificates ?? []
      const certificateExists = savedCertificates.some((certificate) =>
        certificate.id === nextCertificate.id ||
        Boolean(nextCertificate.purchasePaymentId && certificate.purchasePaymentId === nextCertificate.purchasePaymentId),
      )
      const nextCertificates = certificateExists
        ? savedCertificates.map((certificate) =>
            certificate.id === nextCertificate.id ||
            Boolean(nextCertificate.purchasePaymentId && certificate.purchasePaymentId === nextCertificate.purchasePaymentId)
              ? nextCertificate
              : certificate,
          )
        : [nextCertificate, ...savedCertificates]

      return {
        ...current,
        certificates: nextCertificates,
        payments: current.payments.map((payment) =>
          payment.id === nextCertificate.purchasePaymentId
            ? {
                ...payment,
                date: purchaseDate,
                month: purchaseDate.slice(0, 7),
                clientName,
                amount,
                service: `Сертификат ${nextCertificate.number}`,
                cash: amount > 0,
                comment,
              }
            : payment,
        ),
      }
    })
    setEditingCertificate(null)
  }

  const deleteCertificate = (certificateId: string) => {
    if (!auth.canEdit) return
    const certificate = getCertificates(data).find((item) => item.id === certificateId)
    if (!certificate) return
    void softDeleteCloudRecords({
      certificates: [certificate.id],
      payments: certificate.purchasePaymentId ? [certificate.purchasePaymentId] : [],
    })
    setData((current) => ({
      ...current,
      certificates: (current.certificates ?? []).filter((item) =>
        item.id !== certificate.id &&
        (!certificate.purchasePaymentId || item.purchasePaymentId !== certificate.purchasePaymentId),
      ),
      payments: certificate.purchasePaymentId
        ? current.payments.filter((payment) => payment.id !== certificate.purchasePaymentId)
        : current.payments,
    }))
    setEditingCertificate(null)
  }

  const saveMembership = (formData: FormData) => {
    if (!auth.canEdit) return
    setMembershipActionError(undefined)
    const hasUsage = Boolean(editingMembership && (data.membershipRedemptions ?? []).some(
      (redemption) => redemption.membershipId === editingMembership.id,
    ))
    const purchaseDate = hasUsage
      ? editingMembership!.purchaseDate
      : String(formData.get('purchaseDate') || todayIso)
    const kind = hasUsage
      ? editingMembership!.kind
      : String(formData.get('kind') || 'sessions') as MembershipKind
    const purchaseAmount = hasUsage
      ? editingMembership!.purchaseAmount
      : Math.max(0, Number(formData.get('purchaseAmount') || 0))
    const clientId = editingMembership?.clientId ?? `client-${crypto.randomUUID()}`
    const purchasePaymentId = editingMembership?.purchasePaymentId ?? `payment-membership-${crypto.randomUUID()}`
    const phone = hasUsage
      ? editingMembership?.phone ?? ''
      : String(formData.get('phone') || '').trim()
    const membership: Membership = {
      id: editingMembership?.id ?? `membership-${crypto.randomUUID()}`,
      clientId,
      clientName: hasUsage
        ? editingMembership!.clientName
        : String(formData.get('clientName') || '').trim() || 'Не указан',
      phone: phone || undefined,
      whatsapp: phone || undefined,
      telegram: hasUsage
        ? editingMembership?.telegram
        : String(formData.get('telegram') || '').trim() || undefined,
      instagram: hasUsage
        ? editingMembership?.instagram
        : String(formData.get('instagram') || '').trim() || undefined,
      name: hasUsage
        ? editingMembership!.name
        : String(formData.get('name') || '').trim() || 'Абонемент',
      kind,
      purchasePaymentId,
      purchaseDate,
      expiresAt: String(formData.get('expiresAt') || editingMembership?.expiresAt || addMonths(purchaseDate, 6)),
      purchaseAmount,
      initialSessions: kind === 'sessions'
        ? hasUsage ? editingMembership?.initialSessions : Math.max(1, Number(formData.get('initialSessions') || 1))
        : undefined,
      initialBalance: kind === 'balance'
        ? hasUsage ? editingMembership?.initialBalance : Math.max(1, Number(formData.get('initialBalance') || purchaseAmount))
        : undefined,
      allowedServiceTypes: hasUsage
        ? editingMembership?.allowedServiceTypes ?? []
        : formData.getAll('allowedServiceTypes').map(String),
      comment: String(formData.get('comment') || '').trim() || undefined,
    }
    const payment: Payment = {
      id: purchasePaymentId,
      date: membership.purchaseDate,
      month: membership.purchaseDate.slice(0, 7),
      type: 'Абонементы',
      clientName: membership.clientName,
      status: 'Продажа абонемента',
      amount: membership.purchaseAmount,
      teacher: 'Другое',
      service: membership.name,
      cash: membership.purchaseAmount > 0,
      source: 'Продажа абонемента',
      comment: membership.comment,
    }

    setData((current) => ({
      ...current,
      clients: current.clients.some((client) => client.id === clientId)
        ? current.clients.map((client) => client.id === clientId
            ? {
                ...client,
                name: membership.clientName,
                phone: membership.phone,
                whatsapp: membership.whatsapp,
                telegram: membership.telegram,
                instagram: membership.instagram,
              }
            : client)
        : [...current.clients, {
            id: clientId,
            name: membership.clientName,
            phone: membership.phone,
            whatsapp: membership.whatsapp,
            telegram: membership.telegram,
            instagram: membership.instagram,
          }],
      memberships: editingMembership
        ? (current.memberships ?? []).map((item) => item.id === membership.id ? membership : item)
        : [membership, ...(current.memberships ?? [])],
      payments: hasUsage
        ? current.payments
        : current.payments.some((item) => item.id === purchasePaymentId)
          ? current.payments.map((item) => item.id === purchasePaymentId ? payment : item)
          : [payment, ...current.payments],
    }))
    setSelectedMonth(membership.purchaseDate.slice(0, 7))
    setEditingMembership(null)
    setShowMembershipForm(false)
  }

  const deleteMembership = (membershipId: string) => {
    if (!auth.canEdit) return
    const membership = (data.memberships ?? []).find((item) => item.id === membershipId)
    if (!membership) return
    if ((data.membershipRedemptions ?? []).some((redemption) => redemption.membershipId === membershipId)) {
      setMembershipActionError('Использованный абонемент нельзя удалить: история посещений должна сохраниться.')
      return
    }
    void softDeleteCloudRecords({
      memberships: [membershipId],
      payments: membership.purchasePaymentId ? [membership.purchasePaymentId] : [],
    })
    setData((current) => ({
      ...current,
      memberships: (current.memberships ?? []).filter((item) => item.id !== membershipId),
      payments: membership.purchasePaymentId
        ? current.payments.filter((payment) => payment.id !== membership.purchasePaymentId)
        : current.payments,
    }))
    setEditingMembership(null)
  }

  const saveGuestMaster = (formData: FormData) => {
    if (!auth.canEdit) return
    const name = String(formData.get('name') || '').trim()
    if (!name) return
    const defaultRatePercent = normalizeRatePercent(Number(formData.get('defaultRatePercent') || 50))

    setData((current) => {
      const currentMasters = current.guestMasters ?? []
      if (editingGuestMaster) {
        return {
          ...current,
          guestMasters: currentMasters.map((master) =>
            master.id === editingGuestMaster.id ? { ...master, name, defaultRatePercent } : master,
          ),
        }
      }

      return {
        ...current,
        guestMasters: [
          ...currentMasters,
          {
            id: `guest-master-${crypto.randomUUID()}`,
            name,
            defaultRatePercent,
            isActive: true,
          },
        ],
      }
    })
    setEditingGuestMaster(null)
    setShowGuestMasterForm(false)
  }

  const toggleGuestMasterActive = (masterId: string) => {
    if (!auth.canEdit) return
    setData((current) => ({
      ...current,
      guestMasters: (current.guestMasters ?? []).map((master) =>
        master.id === masterId ? { ...master, isActive: !master.isActive } : master,
      ),
    }))
    setEditingGuestMaster((current) =>
      current?.id === masterId ? { ...current, isActive: !current.isActive } : current,
    )
  }

  return (
    <div className="appShell">
      <header className="topBar">
        <div>
          <p className="eyeline">{formatDateLong(todayIso)}</p>
        </div>
      </header>

      <main className="screen">
        {membershipActionError && <div className="actionError">{membershipActionError}</div>}
        {activeTab === 'today' && (
          <TodayScreen
            allAppointments={data.appointments}
            auth={auth}
            appointments={todayAppointments}
            canEdit={auth.canEdit}
            deals={data.deals}
            memberships={data.memberships ?? []}
            membershipRedemptions={data.membershipRedemptions ?? []}
            upcoming={upcomingAppointments}
            stats={stats}
            onEditAppointment={setEditingAppointment}
            onStatusChange={updateAppointmentStatus}
          />
        )}
        {activeTab === 'calendar' && (
          <CalendarScreen
            appointments={data.appointments}
            canEdit={auth.canEdit}
            deals={data.deals}
            memberships={data.memberships ?? []}
            membershipRedemptions={data.membershipRedemptions ?? []}
            filter={calendarFilter}
            readinessCount={stats.readinessAttention}
            setFilter={setCalendarFilter}
            onEditAppointment={setEditingAppointment}
            onStatusChange={updateAppointmentStatus}
          />
        )}
        {activeTab === 'finance' && (
          <FinanceScreen
            canEdit={auth.canEdit}
            canExport={auth.isKnownStaff && Boolean(supabase)}
            isExporting={isExportingReport}
            exportError={reportError}
            onExport={exportReport}
            stats={stats}
            monthOptions={monthOptions}
            selectedMonth={selectedMonth}
            setSelectedMonth={setSelectedMonth}
            onAddExpense={() => setShowExpenseForm(true)}
            onEditExpense={setEditingExpense}
          />
        )}
        {activeTab === 'more' && (
          <MoreScreen
            auth={auth}
            canEdit={auth.canEdit}
            data={data}
            stats={stats}
            syncMeta={syncMeta}
            onAddCertificate={() => setShowCertificateForm(true)}
            onAddMembership={() => {
              setMembershipActionError(undefined)
              setEditingMembership(null)
              setShowMembershipForm(true)
            }}
            onAddGuestMaster={() => {
              setEditingGuestMaster(null)
              setShowGuestMasterForm(true)
            }}
            onEditCertificate={setEditingCertificate}
            onEditMembership={(membership) => {
              setMembershipActionError(undefined)
              setEditingMembership(membership)
            }}
            onEditGuestMaster={setEditingGuestMaster}
          />
        )}
      </main>

      <BottomNav
        activeTab={activeTab}
        canEdit={auth.canEdit}
        readinessCount={stats.readinessAttention}
        setActiveTab={setActiveTab}
        onNewAppointment={() => setShowAppointmentForm(true)}
      />

      {showAppointmentForm && (
        <Sheet title="Новая запись" onClose={() => setShowAppointmentForm(false)}>
          <AppointmentForm
            defaultTeacher={auth.defaultTeacher}
            guestMasters={data.guestMasters ?? []}
            memberships={data.memberships ?? []}
            membershipRedemptions={data.membershipRedemptions ?? []}
            serviceTypes={data.serviceTypes}
            onSubmit={addAppointment}
          />
        </Sheet>
      )}
      {editingAppointment && (
        <Sheet title="Редактировать запись" onClose={() => setEditingAppointment(null)}>
          <AppointmentForm
            appointment={editingAppointment}
            defaultTeacher={auth.defaultTeacher}
            guestMasters={data.guestMasters ?? []}
            memberships={data.memberships ?? []}
            membershipRedemptions={data.membershipRedemptions ?? []}
            photoStatus={photoUploadState[editingAppointment.id]}
            serviceTypes={data.serviceTypes}
            submitLabel="Сохранить изменения"
            onDelete={() => void deleteAppointment(editingAppointment.id)}
            onDeletePhoto={(photoId) => void deleteAppointmentPhoto(editingAppointment.id, photoId)}
            onUploadPhotos={(files) => void uploadAppointmentPhotos(editingAppointment.id, files)}
            onSubmit={(formData) => editAppointment(editingAppointment.id, formData)}
          />
        </Sheet>
      )}
      {showMembershipForm && (
        <Sheet title="Новый абонемент" onClose={() => setShowMembershipForm(false)}>
          <MembershipForm
            redemptions={data.membershipRedemptions ?? []}
            serviceTypes={data.serviceTypes}
            onSubmit={saveMembership}
          />
        </Sheet>
      )}
      {editingMembership && (
        <Sheet title="Редактировать абонемент" onClose={() => setEditingMembership(null)}>
          <MembershipForm
            membership={editingMembership}
            redemptions={data.membershipRedemptions ?? []}
            serviceTypes={data.serviceTypes}
            submitLabel="Сохранить изменения"
            onDelete={() => deleteMembership(editingMembership.id)}
            onSubmit={saveMembership}
          />
        </Sheet>
      )}
      {showExpenseForm && (
        <Sheet title="Новый расход" onClose={() => setShowExpenseForm(false)}>
          <ExpenseForm onSubmit={addExpense} />
        </Sheet>
      )}
      {editingExpense && (
        <Sheet title="Редактировать расход" onClose={() => setEditingExpense(null)}>
          <ExpenseForm
            expense={editingExpense}
            submitLabel="Сохранить изменения"
            onDelete={() => deleteExpense(editingExpense.id)}
            onSubmit={(formData) => editExpense(editingExpense.id, formData)}
          />
        </Sheet>
      )}
      {showCertificateForm && (
        <Sheet title="Новый сертификат" onClose={() => setShowCertificateForm(false)}>
          <CertificateForm
            defaultTeacher={auth.defaultTeacher}
            nextNumber={getNextCertificateNumber(getCertificates(data))}
            onSubmit={addCertificate}
          />
        </Sheet>
      )}
      {editingCertificate && (
        <Sheet title="Редактировать сертификат" onClose={() => setEditingCertificate(null)}>
          <CertificateForm
            certificate={editingCertificate}
            defaultTeacher={auth.defaultTeacher}
            nextNumber={editingCertificate.number}
            submitLabel="Сохранить изменения"
            onDelete={() => deleteCertificate(editingCertificate.id)}
            onSubmit={(formData) => editCertificate(editingCertificate.id, formData)}
          />
        </Sheet>
      )}
      {(showGuestMasterForm || editingGuestMaster) && (
        <Sheet
          title={editingGuestMaster ? 'Редактировать мастера' : 'Новый мастер'}
          onClose={() => {
            setEditingGuestMaster(null)
            setShowGuestMasterForm(false)
          }}
        >
          <GuestMasterForm
            master={editingGuestMaster ?? undefined}
            onSubmit={saveGuestMaster}
            onToggleActive={editingGuestMaster ? () => toggleGuestMasterActive(editingGuestMaster.id) : undefined}
          />
        </Sheet>
      )}
    </div>
  )
}

function TodayScreen({
  allAppointments,
  auth,
  appointments,
  canEdit,
  deals,
  memberships,
  membershipRedemptions,
  upcoming,
  stats,
  onEditAppointment,
  onStatusChange,
}: {
  allAppointments: Appointment[]
  auth: ReturnType<typeof useAuthProfile>
  appointments: Appointment[]
  canEdit: boolean
  deals: Deal[]
  memberships: Membership[]
  membershipRedemptions: MembershipRedemption[]
  upcoming: Appointment[]
  stats: ReturnType<typeof getDashboardStats>
  onEditAppointment: (appointment: Appointment) => void
  onStatusChange: (appointmentId: string, status: AppointmentStatus) => void
}) {
  const [quickFilter, setQuickFilter] = useState<TodayQuickFilter | null>(null)
  const visible = appointments.length ? appointments : upcoming
  const dealAppointmentPairs = deals
    .map((deal) => ({ deal, appointment: appointmentForDeal(deal, allAppointments) }))
    .filter(({ deal, appointment }) => isOpenDealWithAppointment(deal, appointment))
  const dealGroups: Record<TodayQuickFilter, { appointment?: Appointment; deal: Deal }[]> = {
    open: dealAppointmentPairs,
    overdue: dealAppointmentPairs.filter(({ deal }) => deal.expectedReadyDate < todayIso),
    notify: dealAppointmentPairs.filter(({ deal }) => deal.status === 'Готово к выдаче'),
  }
  const quickFilterMeta = {
    open: { label: 'Открыто', title: 'Открытые сделки', value: stats.openDeals, tone: 'waiting' },
    overdue: { label: 'Просрочено', title: 'Просроченные сделки', value: stats.overdueDeals, tone: 'alert' },
    notify: { label: 'К оповещению', title: 'К оповещению', value: stats.notifyDeals, tone: 'info' },
  } satisfies Record<TodayQuickFilter, { label: string; title: string; value: number; tone: string }>
  const selectedDealAppointments = quickFilter
    ? dealGroups[quickFilter]
        .map(({ appointment, deal }) => (appointment ? { appointment, deal } : null))
        .filter((item): item is { appointment: Appointment; deal: Deal } => Boolean(item))
    : []
  const listTitle = quickFilter
    ? quickFilterMeta[quickFilter].title
    : appointments.length
      ? 'Записи на сегодня'
      : 'Ближайшие записи'

  return (
    <section className="stack">
      <div className="heroPanel">
        <div className="heroTitleBlock">
          <h2>{appointments.length ? `Сегодня · ${appointments.length} записей` : 'Сегодня · свободно'}</h2>
        </div>
        <AccessSummary auth={auth} />
      </div>

      <div className="quickStats">
        {(Object.keys(quickFilterMeta) as TodayQuickFilter[]).map((filter) => (
          <StatPill
            active={quickFilter === filter}
            disabled={quickFilterMeta[filter].value === 0}
            key={filter}
            label={quickFilterMeta[filter].label}
            value={quickFilterMeta[filter].value}
            tone={quickFilterMeta[filter].tone}
            onClick={() => setQuickFilter((current) => (current === filter ? null : filter))}
          />
        ))}
      </div>

      <SectionHeader title={listTitle} action={quickFilter ? 'Сегодня' : undefined} onAction={() => setQuickFilter(null)} />
      <div className="cardList">
        {quickFilter
          ? selectedDealAppointments.map(({ appointment, deal }) => (
              <AppointmentCard
                appointment={appointment}
                deal={deal}
                memberships={memberships}
                membershipRedemptions={membershipRedemptions}
                key={deal.id}
                onEdit={canEdit ? () => onEditAppointment(appointment) : undefined}
                onStatusChange={canEdit ? (status) => onStatusChange(appointment.id, status) : undefined}
              />
            ))
          : visible.map((appointment) => (
              <AppointmentCard
                appointment={appointment}
                deal={dealForAppointment(appointment, deals)}
                memberships={memberships}
                membershipRedemptions={membershipRedemptions}
                key={appointment.id}
                onEdit={canEdit ? () => onEditAppointment(appointment) : undefined}
                onStatusChange={canEdit ? (status) => onStatusChange(appointment.id, status) : undefined}
              />
            ))}
      </div>
    </section>
  )
}

function AccessSummary({ auth }: { auth: ReturnType<typeof useAuthProfile> }) {
  if (!auth.user) {
    return (
      <button className="authSummaryButton" disabled={auth.isLoading} type="button" onClick={() => void auth.signInWithGoogle()}>
        <LogIn size={17} />
        Войти
      </button>
    )
  }

  const name = auth.canEdit
    ? auth.isAdmin
      ? 'Администратор'
      : auth.profile?.teacher === 'Настя'
        ? 'Анастасия'
        : auth.profile?.teacher ?? 'Сотрудник'
    : 'Режим просмотра'

  return (
    <div className="authSummary">
      <strong>{name}</strong>
    </div>
  )
}

function CalendarScreen({
  appointments,
  canEdit,
  deals,
  memberships,
  membershipRedemptions,
  filter,
  readinessCount,
  setFilter,
  onEditAppointment,
  onStatusChange,
}: {
  appointments: Appointment[]
  canEdit: boolean
  deals: Deal[]
  memberships: Membership[]
  membershipRedemptions: MembershipRedemption[]
  filter: string
  readinessCount: number
  setFilter: (filter: string) => void
  onEditAppointment: (appointment: Appointment) => void
  onStatusChange: (appointmentId: string, status: AppointmentStatus) => void
}) {
  const filtered = appointments
    .filter((appointment) => !isCertificateAppointment(appointment))
    .filter((appointment) => {
      if (filter === 'Все') return true
      if (filter === 'Готовность') return needsReadinessAttentionForAppointment(appointment, deals)
      if (calendarStatusFilters.includes(filter as DealStatus)) {
        const deal = dealForAppointment(appointment, deals)
        return appointment.status === filter || deal?.status === filter
      }
      return appointment.serviceType === filter
    })
    .sort((a, b) => `${b.date}${b.time}`.localeCompare(`${a.date}${a.time}`))
    .slice(0, 80)
  const grouped = groupBy(filtered, (appointment) => appointment.date || 'Без даты')
  const weekStart = startOfWeekMonday(todayIso)
  const weekDays = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index))
  const groupedDates = new Set(Object.keys(grouped))
  const scrollToCalendarDay = (date: string) => {
    document.getElementById(`calendar-day-${date}`)?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    })
  }

  return (
    <section className="stack">
      <div className="weekRail" aria-label="Быстрый переход по дням">
        {weekDays.map((date) => (
          <button
            className={`${date === todayIso ? 'today' : ''} ${groupedDates.has(date) ? 'hasItems' : ''}`}
            key={date}
            type="button"
            onClick={() => scrollToCalendarDay(date)}
          >
            <strong>{formatWeekday(date)}</strong>
            <span>{formatDayNumber(date)}</span>
          </button>
        ))}
      </div>
      <FilterRail
        items={serviceFilters}
        active={filter}
        readinessCount={readinessCount}
        setActive={setFilter}
        statusItems={calendarStatusFilters}
      />
      {!filtered.length && (
        <div className="panel emptyState">
          <h3>Записей нет</h3>
          <p>Для фильтра «{filter}» пока нет записей в календаре.</p>
        </div>
      )}
      {Object.entries(grouped).map(([date, list]) => (
        <div className="dayGroup" id={`calendar-day-${date}`} key={date}>
          <h3>{formatDateLong(date)}</h3>
          <div className="cardList">
            {list.map((appointment) => (
              <AppointmentCard
                appointment={appointment}
                compact
                deal={dealForAppointment(appointment, deals)}
                memberships={memberships}
                membershipRedemptions={membershipRedemptions}
                key={appointment.id}
                onEdit={canEdit ? () => onEditAppointment(appointment) : undefined}
                onStatusChange={canEdit ? (status) => onStatusChange(appointment.id, status) : undefined}
              />
            ))}
          </div>
        </div>
      ))}
    </section>
  )
}

function FinanceScreen({
  canEdit,
  canExport,
  isExporting,
  exportError,
  onExport,
  stats,
  monthOptions,
  selectedMonth,
  setSelectedMonth,
  onAddExpense,
  onEditExpense,
}: {
  canEdit: boolean
  canExport: boolean
  isExporting: boolean
  exportError?: string
  onExport: () => void
  stats: ReturnType<typeof getDashboardStats>
  monthOptions: string[]
  selectedMonth: string
  setSelectedMonth: (month: string) => void
  onAddExpense: () => void
  onEditExpense: (expense: Expense) => void
}) {
  return (
    <section className="stack">
      <div className="toolbar financeToolbar">
        <select value={selectedMonth} onChange={(event) => setSelectedMonth(event.target.value)} aria-label="Месяц">
          {monthOptions.map((month) => (
            <option value={month} key={month}>
              {monthLabel(month)}
            </option>
          ))}
        </select>
        {canEdit && (
          <button className="iconTextButton" type="button" onClick={onAddExpense}>
            <Receipt size={18} />
            Расход
          </button>
        )}
        {canExport && (
          <button className="iconTextButton reportButton" type="button" disabled={isExporting} onClick={onExport}>
            <Download size={18} />
            {isExporting ? 'Готовим файл…' : 'Скачать отчёт'}
          </button>
        )}
      </div>
      {exportError && <p className="syncError" role="alert">{exportError}</p>}

      <div className="financeGrid">
        <MetricCard label="Доходы" value={formatMoney(stats.income)} tone="income" />
        <MetricCard label="Расходы" value={formatMoney(stats.expenses)} tone="expense" />
        <MetricCard label="Прибыль" value={formatMoney(stats.profit)} tone="profit" />
        <MetricCard label="Маржа" value={`${Math.round(stats.margin * 100)}%`} tone="neutral" />
      </div>

      <div className="panel membershipFinancePanel">
        <div className="panelHeader">
          <h3>Абонементы</h3>
          <span className="derivedExpenseTotal">Активно: {stats.membershipStats.active}</span>
        </div>
        <div className="membershipFinanceGrid">
          <div><span>Продано</span><strong>{stats.membershipStats.sold}</strong></div>
          <div><span>Получено</span><strong>{formatMoney(stats.membershipStats.received)}</strong></div>
          <div><span>Посещений</span><strong>{stats.membershipStats.visits}</strong></div>
          <div><span>Обязательства</span><strong>{formatMoney(stats.membershipStats.obligations)}</strong></div>
        </div>
        {stats.membershipStats.unlimitedActive > 0 && (
          <p className="membershipUnlimitedNote">Активных безлимитов: {stats.membershipStats.unlimitedActive}</p>
        )}
      </div>

      <div className="panel">
        <h3>Месяц по людям</h3>
        <div className="teacherFinanceCards">
          {teachers.slice(0, 2).map((teacher) => {
            const teacherStats = stats.staff[teacher]
            return (
              <article className="teacherFinanceCard" key={teacher}>
                <div className="teacherFinanceHeader">
                  <strong>{teacher}</strong>
                  <span>{teacherStats.sessions} занятий</span>
                </div>
                <div className="teacherFinanceMetrics">
                  <div>
                    <span>Доход</span>
                    <strong>{formatMoney(teacherStats.income)}</strong>
                  </div>
                  <div>
                    <span>Расход</span>
                    <strong>{formatMoney(teacherStats.expenses)}</strong>
                  </div>
                  <div>
                    <span>Прибыль</span>
                    <strong>{formatMoney(teacherStats.profit)}</strong>
                  </div>
                </div>
                <div className="membershipTeacherValue">
                  <span>Проведено по абонементам</span>
                  <strong>{formatMoney(teacherStats.membershipValue)}</strong>
                </div>
              </article>
            )
          })}
        </div>
      </div>

      <div className="panel">
        <div className="panelHeader">
          <h3>Приглашенные мастера</h3>
          {stats.guestMasterExpenses > 0 && (
            <span className="derivedExpenseTotal">Доли: {formatMoney(stats.guestMasterExpenses)}</span>
          )}
        </div>
        {stats.guestMasterReports.length ? (
          <div className="guestMasterFinanceList">
            {stats.guestMasterReports.map((report) => (
              <article className="guestMasterFinanceCard" key={report.id}>
                <div className="teacherFinanceHeader">
                  <strong>{report.name}</strong>
                  <span>{report.sessions} {pluralizeSessions(report.sessions)}</span>
                </div>
                <div className="guestMasterFinanceMetrics">
                  <div>
                    <span>Стоимость занятий</span>
                    <strong>{formatMoney(report.clientPayments)}</strong>
                  </div>
                  <div>
                    <span>Мастеру</span>
                    <strong>{formatMoney(report.masterShare)}</strong>
                  </div>
                  <div>
                    <span>Студии</span>
                    <strong>{formatMoney(report.studioShare)}</strong>
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="muted">В этом месяце проведенных занятий с приглашенными мастерами нет.</p>
        )}
      </div>

      <div className="panel">
        <h3>Расходы по категориям</h3>
        {stats.expenseCategories.length ? (
          stats.expenseCategories.map(([category, value]) => (
            <div className="categoryRow" key={category}>
              <span>{category}</span>
              <strong>{formatMoney(value)}</strong>
            </div>
          ))
        ) : (
          <p className="muted">За этот месяц расходов нет.</p>
        )}
      </div>

      <div className="panel">
        <h3>Расходы месяца</h3>
        {stats.monthExpenses.length ? (
          <div className="expenseList">
            {stats.monthExpenses.map((expense) => (
              <article className="expenseCard" key={expense.id}>
                <button
                  aria-label={
                    canEdit
                      ? `Редактировать расход: ${expense.description || expense.category}`
                      : `Расход: ${expense.description || expense.category}`
                  }
                  className="expenseEditButton"
                  disabled={!canEdit}
                  type="button"
                  onClick={() => onEditExpense(expense)}
                >
                  <div>
                    <strong>{expense.description || expense.category}</strong>
                    <span>{formatDate(expense.date)} · {expense.category}</span>
                    {expense.paidBy && <span>Оплатил: {expense.paidBy}</span>}
                  </div>
                  <div>
                    <strong>{formatMoney(expense.amount)}</strong>
                    {canEdit && <ChevronRight size={18} />}
                  </div>
                </button>
              </article>
            ))}
          </div>
        ) : (
          <p className="muted">За этот месяц расходов нет.</p>
        )}
      </div>
    </section>
  )
}

function GuestMastersPanel({
  canEdit,
  masters,
  onAdd,
  onEdit,
}: {
  canEdit: boolean
  masters: GuestMaster[]
  onAdd: () => void
  onEdit: (master: GuestMaster) => void
}) {
  const sortedMasters = [...masters].sort((a, b) => {
    if (a.isActive !== b.isActive) return a.isActive ? -1 : 1
    return a.name.localeCompare(b.name, 'ru')
  })

  return (
    <div className="panel guestMastersPanel">
      <div className="panelHeader">
        <h3>Приглашенные мастера</h3>
        {canEdit && (
          <button className="iconTextButton compactButton" type="button" onClick={onAdd}>
            <Plus size={18} />
            Добавить
          </button>
        )}
      </div>
      {sortedMasters.length ? (
        <div className="guestMasterList">
          {sortedMasters.map((master) => (
            <button
              aria-label={`Редактировать мастера: ${master.name}`}
              className={`guestMasterRow ${master.isActive ? '' : 'archived'}`}
              disabled={!canEdit}
              key={master.id}
              type="button"
              onClick={() => onEdit(master)}
            >
              <span>
                <strong>{master.name}</strong>
                <small>{master.isActive ? 'Активен' : 'В архиве'}</small>
              </span>
              <span className="guestMasterRate">{master.defaultRatePercent}%</span>
              {canEdit && <ChevronRight size={18} />}
            </button>
          ))}
        </div>
      ) : (
        <p className="muted">Добавьте мастера, чтобы назначать его в записи и учитывать долю.</p>
      )}
    </div>
  )
}

function MoreScreen({
  auth,
  canEdit,
  data,
  stats,
  syncMeta,
  onAddCertificate,
  onAddMembership,
  onAddGuestMaster,
  onEditCertificate,
  onEditMembership,
  onEditGuestMaster,
}: {
  auth: ReturnType<typeof useAuthProfile>
  canEdit: boolean
  data: AppData
  stats: ReturnType<typeof getDashboardStats>
  syncMeta: ReturnType<typeof useSyncedAppData<AppData>>[2]
  onAddCertificate: () => void
  onAddMembership: () => void
  onAddGuestMaster: () => void
  onEditCertificate: (certificate: Certificate) => void
  onEditMembership: (membership: Membership) => void
  onEditGuestMaster: (master: GuestMaster) => void
}) {
  const certificates = getCertificates(data)
  const [showCertificates, setShowCertificates] = useState(true)
  return (
    <section className="stack">
      <AccessPanel auth={auth} />
      <MembershipsPanel
        canEdit={canEdit}
        memberships={data.memberships ?? []}
        redemptions={data.membershipRedemptions ?? []}
        onAdd={onAddMembership}
        onEdit={onEditMembership}
      />
      <GuestMastersPanel
        canEdit={canEdit}
        masters={data.guestMasters ?? []}
        onAdd={onAddGuestMaster}
        onEdit={onEditGuestMaster}
      />
      <div className="panel">
        <div className="panelHeader">
          <h3>Сертификаты</h3>
          <div className="panelActions">
            <button className="secondaryButton compactButton" type="button" onClick={() => setShowCertificates((value) => !value)}>
              {showCertificates ? 'Скрыть' : 'Показать'}
            </button>
            {canEdit && (
              <button className="iconTextButton" type="button" onClick={onAddCertificate}>
                <Plus size={18} />
                Добавить
              </button>
            )}
          </div>
        </div>
        {showCertificates && certificates.length ? (
          <div className="certificateList">
            {certificates.map((certificate) => (
              <article className={`certificateCard ${certificate.usedAt ? 'used' : ''}`} key={certificate.id}>
                <div className="certificateContent">
                  <div>
                    <strong>{certificate.number}</strong>
                    <span>{certificate.clientName}</span>
                  </div>
                  <div>
                    <span>Покупка: {formatDate(certificate.purchaseDate)}</span>
                    <span>До: {formatDate(certificate.expiresAt)}</span>
                  </div>
                  <div>
                    <strong>{formatMoney(certificate.amount)}</strong>
                    <span>{certificate.teacher && certificate.teacher !== 'Другое' ? certificate.teacher : 'Преподаватель не выбран'}</span>
                  </div>
                  <span className={`certificateStatus ${certificate.usedAt ? 'used' : 'active'}`}>
                    {certificate.usedAt ? `Использован ${formatDate(certificate.usedAt)}` : 'Продан'}
                  </span>
                </div>
                {canEdit ? (
                  <button
                    aria-label={`Редактировать сертификат ${certificate.number}`}
                    className="chevronButton"
                    type="button"
                    onClick={() => onEditCertificate(certificate)}
                  >
                    <ChevronRight size={18} />
                  </button>
                ) : (
                  <ChevronRight className="chevron" size={18} />
                )}
              </article>
            ))}
          </div>
        ) : showCertificates ? (
          <p className="muted">Покупок сертификатов пока нет.</p>
        ) : (
          <p className="muted">Список сертификатов скрыт.</p>
        )}
      </div>

      <div className="panel">
        <h3>Статистика Алина / Настя</h3>
        <div className="staffCards">
          {teachers.slice(0, 2).map((teacher) => {
            const stat = stats.staff[teacher]
            return (
              <article className="staffCard" key={teacher}>
                <h4>{teacher}</h4>
                <dl>
                  <div><dt>Занятий</dt><dd>{stat.sessions}</dd></div>
                  <div><dt>Открыто</dt><dd>{stat.openDeals}</dd></div>
                  <div><dt>Закрыто</dt><dd>{stat.closedDeals}</dd></div>
                  <div><dt>Доход</dt><dd>{formatMoney(stat.income)}</dd></div>
                  <div><dt>По абонементам</dt><dd>{formatMoney(stat.membershipValue)}</dd></div>
                  <div><dt>Средний чек</dt><dd>{formatMoney(stat.averageCheck)}</dd></div>
                  <div><dt>Рабочие дни</dt><dd>{stat.workDays}</dd></div>
                  <div><dt>Ждут изделие</dt><dd>{stat.waitingItems}</dd></div>
                  <div><dt>Оповестить</dt><dd>{stat.notifyDeals}</dd></div>
                  <div><dt>Просрочено</dt><dd>{stat.overdueDeals}</dd></div>
                </dl>
              </article>
            )
          })}
        </div>
      </div>

      <div className="panel sourcePanel">
        <h3>Данные</h3>
        <p>
          {syncMeta.isRemoteEnabled
            ? `Данные автоматически сохраняются в Supabase. Статус: ${syncStatusLabel(syncMeta.status)}.`
            : 'Данные сохраняются только на этом устройстве.'}
        </p>
        {syncMeta.error && <p className="syncError">Ошибка синхронизации: {syncMeta.error}</p>}
        <p>{data.clients.length} клиентов, {data.appointments.length} записей, {data.deals.length} сделок.</p>
      </div>
    </section>
  )
}

function AccessPanel({ auth }: { auth: ReturnType<typeof useAuthProfile> }) {
  const statusLabel = auth.canEdit
    ? auth.isAdmin
      ? 'Редактор: админ'
      : `Редактор: ${auth.profile?.teacher ?? 'сотрудник'}`
    : 'Режим просмотра'

  return (
    <div className="panel accessPanel">
      <div>
        <span className={auth.canEdit ? 'accessBadge editor' : 'accessBadge readonly'}>
          {statusLabel}
        </span>
        {auth.user?.email && <p className="accessEmail">{auth.user.email}</p>}
        {auth.error && <p className="syncError">{auth.error}</p>}
      </div>
      {auth.user ? (
        <button className="secondaryButton compactButton" type="button" onClick={() => void auth.signOut()}>
          <LogOut size={17} />
          Выйти
        </button>
      ) : (
        <button className="iconTextButton" disabled={auth.isLoading} type="button" onClick={() => void auth.signInWithGoogle()}>
          <LogIn size={17} />
          Войти
        </button>
      )}
    </div>
  )
}

function AppointmentCard({
  appointment,
  compact = false,
  deal,
  memberships = [],
  membershipRedemptions = [],
  onEdit,
  onStatusChange,
}: {
  appointment: Appointment
  compact?: boolean
  deal?: Deal
  memberships?: Membership[]
  membershipRedemptions?: MembershipRedemption[]
  onEdit?: () => void
  onStatusChange?: (status: AppointmentStatus) => void
}) {
  const [statusMenuOpen, setStatusMenuOpen] = useState(false)
  const displayStatus = deal?.status ?? appointment.status
  const membership = memberships.find((item) => item.id === appointment.membershipId)
  const redemption = redemptionForAppointment(appointment.id, membershipRedemptions)
  const splitBase = redemption?.allocatedValue ?? appointment.amount
  const guestSplit = appointment.guestMasterId && appointment.guestMasterRatePercent != null
    ? calculateGuestSplit(splitBase, appointment.guestMasterRatePercent)
    : undefined
  const conductorName = appointment.guestMasterName ?? appointment.sourceTeacher ?? appointment.teacher
  const membershipText = appointment.paymentMethod === 'membership'
    ? membership
      ? membershipBalanceLabel(membership, membershipRedemptions)
      : appointment.membershipName ?? 'Абонемент'
    : undefined

  return (
    <article className="appointmentCard">
      <div className="timeBlock">
        <strong>{appointment.time}</strong>
        <span>{formatDate(appointment.date)}</span>
      </div>
      <div className="cardMain">
        <div className="cardTitleLine">
          <h3>{appointment.clientName}</h3>
          {onStatusChange ? (
            <div className="statusControl">
              <button
                aria-expanded={statusMenuOpen}
                aria-label={`Статус: ${displayStatus}`}
                className={`statusChip statusChipButton ${statusClass(displayStatus)}`}
                type="button"
                onClick={() => setStatusMenuOpen((isOpen) => !isOpen)}
              >
                {displayStatus}
              </button>
              {statusMenuOpen && (
                <div className="statusMenu">
                  {quickStatusOptions.map((status) => (
                    <button
                      className={status === displayStatus ? 'active' : ''}
                      key={status}
                      type="button"
                      onClick={() => {
                        onStatusChange(status)
                        setStatusMenuOpen(false)
                      }}
                    >
                      {status}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <span className={`statusChip ${statusClass(displayStatus)}`}>{displayStatus}</span>
          )}
        </div>
        <p className="serviceLine">{appointment.serviceType} · {appointment.item}</p>
        {!compact && (
          <div className="quickActions">
            <ContactButton icon={<Phone />} label="Позвонить" href={normalizePhoneLink(appointment.phone)} />
            <ContactButton icon={<MessageCircle />} label="WhatsApp" href={normalizeWhatsAppLink(appointment.whatsapp)} />
            <ContactButton icon={<Send />} label="Telegram" href={normalizeTelegramLink(appointment.telegram)} />
            <ContactButton icon={<AtSign />} label="Instagram" href={normalizeInstagramLink(appointment.instagram)} />
          </div>
        )}
        <div className="metaLine">
          <span>{conductorName}</span>
          <span>{appointment.peopleCount ?? 1} чел.</span>
          <strong>{formatMoney(appointment.amount)}</strong>
        </div>
        {membershipText && (
          <div className="membershipAppointmentLine">
            <span>Абонемент</span>
            <strong>{membershipText}</strong>
          </div>
        )}
        {guestSplit && (
          <div className={`guestSplitLine ${displayStatus === 'Бронь' ? 'planned' : ''}`}>
            {displayStatus === 'Бронь'
              ? `План: студии ${formatMoney(guestSplit.studioShare)} · мастеру ${formatMoney(guestSplit.masterShare)}`
              : `В студию ${formatMoney(guestSplit.studioShare)} · Мастеру ${formatMoney(guestSplit.masterShare)}`}
          </div>
        )}
        {deal && <DealSummaryChips deal={deal} />}
        {appointment.photos?.length ? <PhotoStrip photos={appointment.photos} /> : null}
      </div>
      {onEdit ? (
        <button
          aria-label={`Открыть запись: ${appointment.clientName}`}
          className="chevronButton"
          type="button"
          onClick={onEdit}
        >
          <ChevronRight size={18} />
        </button>
      ) : (
        <ChevronRight className="chevron" size={18} />
      )}
    </article>
  )
}

function DealSummaryChips({ deal }: { deal: Deal }) {
  const overdue = isOpenDeal(deal) && deal.expectedReadyDate < todayIso
  const visitPassed = deal.visitDate <= todayIso
  const readinessText = visitPassed
    ? `${daysBetween(deal.visitDate)} дн. · Готовность ${formatDate(deal.expectedReadyDate)}`
    : `Готовность ${formatDate(deal.expectedReadyDate)}`

  return (
    <div className="dealChipRow">
      <span className={overdue ? 'warning' : ''}>{readinessText}</span>
    </div>
  )
}

function PhotoStrip({ photos }: { photos: ProductPhoto[] }) {
  return (
    <div className="photoStrip">
      {photos.slice(0, maxAppointmentPhotos).map((photo) => (
        <button
          aria-label="Открыть фото изделия"
          className="photoStripButton"
          key={photo.id}
          type="button"
          onClick={() => window.open(photo.url, '_blank', 'noopener,noreferrer')}
        >
          <img alt="Фото изделия" src={photo.url} loading="lazy" />
        </button>
      ))}
    </div>
  )
}

function AppointmentForm({
  appointment,
  defaultTeacher,
  guestMasters,
  memberships,
  membershipRedemptions,
  photoStatus,
  serviceTypes,
  submitLabel = 'Сохранить запись',
  onDelete,
  onDeletePhoto,
  onSubmit,
  onUploadPhotos,
}: {
  appointment?: Appointment
  defaultTeacher: Teacher
  guestMasters: GuestMaster[]
  memberships: Membership[]
  membershipRedemptions: MembershipRedemption[]
  photoStatus?: string
  serviceTypes: string[]
  submitLabel?: string
  onDelete?: () => void
  onDeletePhoto?: (photoId: string) => void
  onSubmit: (formData: FormData) => void
  onUploadPhotos?: (files: FileList) => void
}) {
  const photos = appointment?.photos ?? []
  const canUploadPhotos = Boolean(appointment && onUploadPhotos && photos.length < maxAppointmentPhotos)
  const [clientName, setClientName] = useState(appointment?.clientName ?? '')
  const [phoneValue, setPhoneValue] = useState(appointment?.phone ?? appointment?.whatsapp ?? '')
  const [telegramValue, setTelegramValue] = useState(appointment?.telegram ?? '')
  const [instagramValue, setInstagramValue] = useState(appointment?.instagram ?? '')
  const instagramLink = normalizeInstagramLink(instagramValue)
  const initialConductor = appointment?.guestMasterId
    ? `guest:${appointment.guestMasterId}`
    : `teacher:${appointment?.teacher ?? defaultTeacher}`
  const [conductor, setConductor] = useState(initialConductor)
  const [amountValue, setAmountValue] = useState(String(appointment?.amount ?? 1200))
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'membership'>(
    appointment?.paymentMethod === 'membership' ? 'membership' : 'cash',
  )
  const [membershipId, setMembershipId] = useState(appointment?.membershipId ?? '')
  const [serviceTypeValue, setServiceTypeValue] = useState(appointment?.serviceType ?? 'Групповые')
  const initialGuestMaster = guestMasters.find((master) => master.id === appointment?.guestMasterId)
  const [rateValue, setRateValue] = useState(String(
    appointment?.guestMasterRatePercent ?? initialGuestMaster?.defaultRatePercent ?? 50,
  ))
  const selectedGuestMaster = conductor.startsWith('guest:')
    ? guestMasters.find((master) => master.id === conductor.slice(6))
    : undefined
  const selectedMembership = memberships.find((membership) => membership.id === membershipId)
  const currentRedemption = appointment
    ? redemptionForAppointment(appointment.id, membershipRedemptions)
    : undefined
  const membershipLocked = Boolean(currentRedemption && appointment?.status !== 'Бронь')
  const activeMemberships = memberships.filter((membership) =>
    membership.id === appointment?.membershipId || getMembershipStatus(membership, membershipRedemptions, todayIso) === 'Активен',
  )
  const availableServices = selectedMembership?.allowedServiceTypes.length
    ? selectedMembership.allowedServiceTypes
    : serviceTypes
  const membershipEconomicAmount = selectedMembership
    ? selectedMembership.kind === 'sessions'
      ? selectedMembership.purchaseAmount / Math.max(1, selectedMembership.initialSessions ?? 1)
      : selectedMembership.kind === 'balance'
        ? selectedMembership.purchaseAmount * (Number(amountValue) || 0) / Math.max(1, selectedMembership.initialBalance ?? selectedMembership.purchaseAmount)
        : Number(amountValue) || 0
    : Number(amountValue) || 0
  const splitPreview = selectedGuestMaster
    ? calculateGuestSplit(membershipEconomicAmount, Number(rateValue) || 0)
    : undefined
  const selectableGuestMasters = guestMasters.filter(
    (master) => master.isActive || master.id === appointment?.guestMasterId,
  )
  const chooseMembership = (nextMembershipId: string) => {
    const nextMembership = memberships.find((membership) => membership.id === nextMembershipId)
    setMembershipId(nextMembershipId)
    if (!nextMembership) return
    setClientName(nextMembership.clientName)
    setPhoneValue(nextMembership.phone ?? nextMembership.whatsapp ?? '')
    setTelegramValue(nextMembership.telegram ?? '')
    setInstagramValue(nextMembership.instagram ?? '')
    if (nextMembership.allowedServiceTypes.length) setServiceTypeValue(nextMembership.allowedServiceTypes[0])
    if (nextMembership.kind === 'sessions') {
      setAmountValue(String(Math.round(nextMembership.purchaseAmount / Math.max(1, nextMembership.initialSessions ?? 1))))
    }
  }

  return (
    <form className="formStack" onSubmit={(event) => handleSubmit(event, onSubmit)}>
      <div className="paymentMethodControl" aria-label="Способ оплаты">
        <button
          className={paymentMethod === 'cash' ? 'active' : ''}
          disabled={membershipLocked}
          type="button"
          onClick={() => setPaymentMethod('cash')}
        >
          Оплата на месте
        </button>
        <button
          className={paymentMethod === 'membership' ? 'active' : ''}
          disabled={membershipLocked || activeMemberships.length === 0}
          type="button"
          onClick={() => {
            setPaymentMethod('membership')
            if (!membershipId && activeMemberships[0]) chooseMembership(activeMemberships[0].id)
          }}
        >
          Абонемент
        </button>
      </div>
      <input name="paymentMethod" type="hidden" value={paymentMethod} />
      {paymentMethod === 'membership' && (
        <div className="membershipPicker">
          <label>Абонемент
            <select
              name="membershipId"
              required
              disabled={membershipLocked}
              value={membershipId}
              onChange={(event) => chooseMembership(event.currentTarget.value)}
            >
              <option value="">Выберите абонемент</option>
              {activeMemberships.map((membership) => (
                <option value={membership.id} key={membership.id}>{membership.name} · {membership.clientName}</option>
              ))}
            </select>
          </label>
          {membershipLocked && <input name="membershipId" type="hidden" value={membershipId} />}
          {selectedMembership && (
            <div className="membershipPickerBalance">
              <strong>{selectedMembership.name}</strong>
              <span>{membershipBalanceLabel(selectedMembership, membershipRedemptions)}</span>
            </div>
          )}
        </div>
      )}
      <div className="contactCompactGrid">
        <label>Имя клиента<input name="clientName" required placeholder="Анна" value={clientName} onChange={(event) => setClientName(event.currentTarget.value)} /></label>
        <label>Instagram
          <span className="linkInputRow">
            <input
              name="instagram"
              placeholder="instagram.com/..."
              value={instagramValue}
              onChange={(event) => setInstagramValue(event.currentTarget.value)}
            />
            {instagramLink && (
              <a className="inlineOpenLink" href={instagramLink} target="_blank" rel="noreferrer">
                Открыть
              </a>
            )}
          </span>
        </label>
        <label>Telegram<input name="telegram" placeholder="@username" value={telegramValue} onChange={(event) => setTelegramValue(event.currentTarget.value)} /></label>
        <label>Телефон / WhatsApp<input name="phone" inputMode="tel" placeholder="+66..." value={phoneValue} onChange={(event) => setPhoneValue(event.currentTarget.value)} /></label>
      </div>
      <div className="bookingCompactGrid">
        <label>Дата<input name="date" type="date" defaultValue={appointment?.date || todayIso} required /></label>
        <label>Время<input name="time" type="time" defaultValue={appointment?.time || '12:00'} required /></label>
        <label>Длит.<input aria-label="Длительность" name="durationMinutes" type="number" defaultValue={appointment?.durationMinutes ?? 150} min="30" step="15" /></label>
        <label>Людей<input aria-label="Кол-во человек" name="peopleCount" type="number" defaultValue={appointment?.peopleCount ?? 1} min="1" step="1" /></label>
        <label>{paymentMethod === 'membership' ? 'Стоимость занятия' : 'Сумма THB'}
          <input
            name="amount"
            type="number"
            value={amountValue}
            min="0"
            disabled={membershipLocked}
            onChange={(event) => setAmountValue(event.currentTarget.value)}
          />
          {membershipLocked && <input name="amount" type="hidden" value={amountValue} />}
        </label>
      </div>
      <label>Тип занятия
        <select name="serviceType" value={serviceTypeValue} onChange={(event) => setServiceTypeValue(event.currentTarget.value)}>
          {Array.from(new Set(availableServices)).map((service) => (
            <option value={service} key={service}>{service}</option>
          ))}
        </select>
      </label>
      <label>Изделие / услуга<input name="item" defaultValue={appointment?.item ?? 'Кружка'} /></label>
      <div className="formGrid">
        <label>Кто проводит
          <select
            name="conductor"
            value={conductor}
            onChange={(event) => {
              const nextConductor = event.currentTarget.value
              setConductor(nextConductor)
              if (nextConductor.startsWith('guest:')) {
                const master = guestMasters.find((item) => item.id === nextConductor.slice(6))
                if (master) setRateValue(String(master.defaultRatePercent))
              }
            }}
          >
            {teachers.map((teacher) => <option value={`teacher:${teacher}`} key={teacher}>{teacher}</option>)}
            {selectableGuestMasters.length > 0 && (
              <optgroup label="Приглашенные мастера">
                {selectableGuestMasters.map((master) => (
                  <option value={`guest:${master.id}`} key={master.id}>
                    {master.name}{master.isActive ? '' : ' · архив'}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </label>
        <label>Статус
          {paymentMethod === 'membership' ? (
            <>
              <select disabled value={editableDealStatus(appointment?.status)}>
                <option>{editableDealStatus(appointment?.status)}</option>
              </select>
              <input name="status" type="hidden" value={appointment?.status ?? 'Бронь'} />
            </>
          ) : (
            <select name="status" defaultValue={editableDealStatus(appointment?.status)}>
              {visibleDealStatuses.map((status) => <option value={status} key={status}>{status}</option>)}
            </select>
          )}
        </label>
      </div>
      {paymentMethod === 'membership' && <p className="formHint">Списание произойдет после смены статуса брони в карточке.</p>}
      {selectedGuestMaster && splitPreview && (
        <div className="guestSplitEditor">
          <label>Ставка мастера
            <span className="rateInputRow">
              <input
                aria-label="Ставка мастера"
                inputMode="decimal"
                max="100"
                min="0"
                name="guestMasterRatePercent"
                type="number"
                value={rateValue}
                onChange={(event) => setRateValue(event.currentTarget.value)}
              />
              <span>%</span>
            </span>
          </label>
          <div className="guestSplitPreview">
            <span>Студии <strong>{formatMoney(splitPreview.studioShare)}</strong></span>
            <span>{selectedGuestMaster.name} <strong>{formatMoney(splitPreview.masterShare)}</strong></span>
          </div>
        </div>
      )}
      {appointment && (
        <div className="photoSection">
          <div className="panelHeader">
            <h3>Фото изделий</h3>
            <span>{photos.length}/{maxAppointmentPhotos}</span>
          </div>
          {photos.length ? (
            <div className="photoGrid">
              {photos.map((photo) => (
                <figure className="photoTile" key={photo.id}>
                  <button
                    aria-label="Открыть фото"
                    className="photoPreviewButton"
                    type="button"
                    onClick={() => window.open(photo.url, '_blank', 'noopener,noreferrer')}
                  >
                    <img alt="Фото изделия" src={photo.url} loading="lazy" />
                  </button>
                  <button className="photoDeleteButton" type="button" onClick={() => onDeletePhoto?.(photo.id)}>
                    Удалить
                  </button>
                </figure>
              ))}
            </div>
          ) : (
            <p className="muted">Можно добавить до двух фото изделия.</p>
          )}
          {canUploadPhotos && (
            <label className="uploadButton">
              <input
                accept="image/*"
                multiple
                type="file"
                onChange={(event) => {
                  if (event.currentTarget.files?.length) onUploadPhotos?.(event.currentTarget.files)
                  event.currentTarget.value = ''
                }}
              />
              Загрузить фото
            </label>
          )}
          {photoStatus && <p className="photoStatus">{photoStatus}</p>}
        </div>
      )}
      <label>Комментарий<textarea name="comment" rows={3} placeholder="Цвет, пожелания, важные детали" defaultValue={appointment?.comment ?? ''} /></label>
      <button className="primaryButton wide" type="submit">{submitLabel}</button>
      {onDelete && (
        <button className="dangerButton wide" type="button" onClick={onDelete}>
          Удалить запись
        </button>
      )}
    </form>
  )
}

function GuestMasterForm({
  master,
  onSubmit,
  onToggleActive,
}: {
  master?: GuestMaster
  onSubmit: (formData: FormData) => void
  onToggleActive?: () => void
}) {
  return (
    <form className="formStack" onSubmit={(event) => handleSubmit(event, onSubmit)}>
      <label>Имя мастера
        <input name="name" required placeholder="Имя" defaultValue={master?.name ?? ''} />
      </label>
      <label>Базовая ставка
        <span className="rateInputRow">
          <input
            aria-label="Базовая ставка"
            inputMode="decimal"
            max="100"
            min="0"
            name="defaultRatePercent"
            required
            type="number"
            defaultValue={master?.defaultRatePercent ?? 50}
          />
          <span>%</span>
        </span>
      </label>
      <p className="formHint">Ставка применяется только к новым записям. Старые занятия сохранят свой процент.</p>
      <button className="primaryButton wide" type="submit">
        {master ? 'Сохранить изменения' : 'Добавить мастера'}
      </button>
      {master && onToggleActive && (
        <button className="secondaryButton wide" type="button" onClick={onToggleActive}>
          {master.isActive ? 'Архивировать мастера' : 'Вернуть из архива'}
        </button>
      )}
    </form>
  )
}

function CertificateForm({
  certificate,
  defaultTeacher,
  nextNumber,
  submitLabel = 'Сохранить сертификат',
  onDelete,
  onSubmit,
}: {
  certificate?: Certificate
  defaultTeacher: Teacher
  nextNumber: string
  submitLabel?: string
  onDelete?: () => void
  onSubmit: (formData: FormData) => void
}) {
  return (
    <form className="formStack" onSubmit={(event) => handleSubmit(event, onSubmit)}>
      <div className="formGrid">
        <label>Номер<input name="number" defaultValue={certificate?.number ?? nextNumber} required /></label>
        <label>Дата продажи<input name="purchaseDate" type="date" defaultValue={certificate?.purchaseDate ?? todayIso} required /></label>
      </div>
      <label>Клиент<input name="clientName" placeholder="Имя клиента" defaultValue={certificate?.clientName ?? ''} required /></label>
      <div className="formGrid">
        <label>Сумма THB<input name="amount" type="number" defaultValue={certificate?.amount ?? 1200} min="0" /></label>
        <label>Кто проводит
          <select name="teacher" defaultValue={certificate?.teacher ?? defaultTeacher}>
            {teachers.map((teacher) => <option value={teacher} key={teacher}>{teacher}</option>)}
          </select>
        </label>
      </div>
      <label className="smallCheck"><input name="used" type="checkbox" defaultChecked={Boolean(certificate?.usedAt)} /> Уже использован</label>
      <label>Комментарий<textarea name="comment" rows={3} placeholder="Кому подарили, детали продажи" defaultValue={certificate?.comment ?? ''} /></label>
      <button className="primaryButton wide" type="submit">{submitLabel}</button>
      {onDelete && (
        <button className="dangerButton wide" type="button" onClick={onDelete}>
          Удалить сертификат
        </button>
      )}
    </form>
  )
}

function ExpenseForm({
  expense,
  submitLabel = 'Сохранить расход',
  onDelete,
  onSubmit,
}: {
  expense?: Expense
  submitLabel?: string
  onDelete?: () => void
  onSubmit: (formData: FormData) => void
}) {
  return (
    <form className="formStack compactExpenseForm" onSubmit={(event) => handleSubmit(event, onSubmit)}>
      <div className="formGrid expenseAmountGrid">
        <label>Дата<input name="date" type="date" defaultValue={expense?.date ?? todayIso} /></label>
        <label>Сумма THB<input name="amount" type="number" min="0" required defaultValue={expense?.amount ?? ''} /></label>
      </div>
      <label>Категория
        <select name="category" defaultValue={expense?.category ?? 'Прочее'}>
          {expenseCategories.map((category) => <option value={category} key={category}>{category}</option>)}
        </select>
      </label>
      <label>Кто оплатил<input name="paidBy" placeholder="Имя или студия" defaultValue={expense?.paidBy ?? ''} /></label>
      <label>Описание<input name="description" placeholder="Что купили или оплатили" defaultValue={expense?.description ?? ''} /></label>
      <button className="primaryButton wide" type="submit">{submitLabel}</button>
      {onDelete && (
        <button className="dangerButton wide" type="button" onClick={onDelete}>
          Удалить расход
        </button>
      )}
    </form>
  )
}

function BottomNav({
  activeTab,
  canEdit,
  readinessCount,
  setActiveTab,
  onNewAppointment,
}: {
  activeTab: Tab
  canEdit: boolean
  readinessCount: number
  setActiveTab: (tab: Tab) => void
  onNewAppointment: () => void
}) {
  const items = [
    { id: 'today' as const, label: 'Сегодня', icon: Home },
    { id: 'calendar' as const, label: 'Календарь', icon: CalendarDays },
    { id: 'finance' as const, label: 'Финансы', icon: Wallet },
    { id: 'more' as const, label: 'Еще', icon: MoreHorizontal },
  ]
  return (
    <nav className="bottomNav" aria-label="Основная навигация">
      {items.map((item) => {
        const Icon = item.icon
        return (
          <Fragment key={item.id}>
            <button
              type="button"
              className={activeTab === item.id ? 'active' : ''}
              onClick={() => setActiveTab(item.id)}
            >
              <span className="navIconWrap">
                <Icon size={22} />
                {item.id === 'calendar' && readinessCount > 0 && (
                  <span className="navBadge">{readinessCount > 99 ? '99+' : readinessCount}</span>
                )}
              </span>
              <span>{item.label}</span>
            </button>
            {item.id === 'finance' && (
              <button
                aria-label="Новая запись"
                className="navActionButton"
                disabled={!canEdit}
                type="button"
                onClick={onNewAppointment}
              >
                <span className="navActionIcon">
                  <Plus size={24} />
                </span>
                <span>Запись</span>
              </button>
            )}
          </Fragment>
        )
      })}
    </nav>
  )
}

function Sheet({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return (
    <div className="sheetBackdrop">
      <section className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="sheetHeader">
          <h2>{title}</h2>
          <button className="secondaryButton" type="button" onClick={onClose}>Закрыть</button>
        </div>
        {children}
      </section>
    </div>
  )
}

function SectionHeader({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <div className="sectionHeader">
      <h2>{title}</h2>
      {action && <button type="button" onClick={onAction}>{action}</button>}
    </div>
  )
}

function FilterRail({
  items,
  active,
  readinessCount = 0,
  setActive,
  statusItems = [],
}: {
  items: string[]
  active: string
  readinessCount?: number
  setActive: (item: string) => void
  statusItems?: string[]
}) {
  const [statusMenuOpen, setStatusMenuOpen] = useState(false)
  const isStatusActive = statusItems.includes(active)

  return (
    <div className="filterRail" aria-label="Фильтры">
      {items.map((item) => {
        const showReadinessBadge = item === 'Готовность' && readinessCount > 0
        return (
          <button
            className={active === item ? 'active' : ''}
            type="button"
            onClick={() => {
              setStatusMenuOpen(false)
              setActive(item)
            }}
            key={item}
          >
            {showReadinessBadge && (
              <span className="filterBadge" aria-hidden="true">
                {readinessCount > 99 ? '99+' : readinessCount}
              </span>
            )}
            {item}
          </button>
        )
      })}
      <div className="filterDropdownWrap">
        <button
          aria-expanded={statusMenuOpen}
          className={isStatusActive ? 'active' : ''}
          type="button"
          onClick={() => setStatusMenuOpen((value) => !value)}
        >
          {isStatusActive ? active : 'Статус'}
        </button>
        {statusMenuOpen && (
          <div className="filterDropdown">
            {statusItems.map((status) => (
              <button
                className={active === status ? 'active' : ''}
                key={status}
                type="button"
                onClick={() => {
                  setActive(status)
                  setStatusMenuOpen(false)
                }}
              >
                {status}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function ContactButton({ icon, label, href }: { icon: ReactNode; label: string; href?: string }) {
  if (!href) {
    return <button className="contactButton disabled" type="button" aria-label={`${label}: нет контакта`}>{icon}</button>
  }
  return <a className="contactButton" href={href} target="_blank" aria-label={label}>{icon}</a>
}

function StatPill({
  active = false,
  disabled = false,
  label,
  onClick,
  tone,
  value,
}: {
  active?: boolean
  disabled?: boolean
  label: string
  onClick?: () => void
  tone: string
  value: number
}) {
  return (
    <button
      className={`statPill ${tone} ${active ? 'active' : ''}`}
      disabled={disabled}
      type="button"
      onClick={onClick}
    >
      <strong>{value}</strong>
      <span>{label}</span>
    </button>
  )
}

function MetricCard({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <article className={`metricCard ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  )
}

function pluralizeSessions(count: number) {
  const remainder100 = count % 100
  const remainder10 = count % 10
  if (remainder100 >= 11 && remainder100 <= 14) return 'занятий'
  if (remainder10 === 1) return 'занятие'
  if (remainder10 >= 2 && remainder10 <= 4) return 'занятия'
  return 'занятий'
}

function handleSubmit(event: FormEvent<HTMLFormElement>, onSubmit: (formData: FormData) => void) {
  event.preventDefault()
  onSubmit(new FormData(event.currentTarget))
}

function parseAppointmentForm(
  formData: FormData,
  guestMasters: GuestMaster[],
  memberships: Membership[],
) {
  const requestedPaymentMethod = String(formData.get('paymentMethod') || 'cash')
  const selectedMembership = requestedPaymentMethod === 'membership'
    ? memberships.find((membership) => membership.id === String(formData.get('membershipId') || ''))
    : undefined
  const paymentMethod: PaymentMethod = selectedMembership ? 'membership' : 'cash'
  const clientName = String(formData.get('clientName') || selectedMembership?.clientName || '').trim() || 'Новый клиент'
  const phone = String(formData.get('phone') || selectedMembership?.phone || selectedMembership?.whatsapp || '').trim()
  const amount = Math.max(0, Number(formData.get('amount') || 0))
  const requestedServiceType = String(formData.get('serviceType') || 'Групповые')
  const serviceType = selectedMembership?.allowedServiceTypes.length && !selectedMembership.allowedServiceTypes.includes(requestedServiceType)
    ? selectedMembership.allowedServiceTypes[0]
    : requestedServiceType
  const item = String(formData.get('item') || '').trim() || serviceType
  const status = String(formData.get('status') || 'Бронь') as AppointmentStatus
  const paid = status !== 'Бронь'
  const conductor = String(formData.get('conductor') || 'teacher:Другое')
  const selectedGuestMaster = conductor.startsWith('guest:')
    ? guestMasters.find((master) => master.id === conductor.slice(6))
    : undefined
  const teacher = selectedGuestMaster
    ? 'Другое'
    : (conductor.replace(/^teacher:/, '') as Teacher)
  const guestMasterRatePercent = selectedGuestMaster
    ? normalizeRatePercent(Number(formData.get('guestMasterRatePercent') || selectedGuestMaster.defaultRatePercent))
    : undefined
  const contact = {
    phone,
    whatsapp: phone,
    telegram: String(formData.get('telegram') || selectedMembership?.telegram || '').trim(),
    instagram: String(formData.get('instagram') || selectedMembership?.instagram || '').trim(),
  }
  return {
    withItem: appointmentCreatesDeal(serviceType),
    contact,
    membership: selectedMembership,
    appointment: {
      clientName,
      ...contact,
      date: String(formData.get('date') || todayIso),
      time: String(formData.get('time') || '12:00'),
      durationMinutes: Number(formData.get('durationMinutes') || 150),
      peopleCount: Math.max(1, Number(formData.get('peopleCount') || 1)),
      serviceType,
      item,
      amount,
      paid,
      cash: paymentMethod === 'cash' && paid && amount > 0,
      teacher,
      sourceTeacher: selectedGuestMaster?.name,
      guestMasterId: selectedGuestMaster?.id,
      guestMasterName: selectedGuestMaster?.name,
      guestMasterRatePercent,
      paymentMethod,
      membershipId: selectedMembership?.id,
      membershipName: selectedMembership?.name,
      membershipChargeAmount: selectedMembership ? amount : undefined,
      status,
      comment: String(formData.get('comment') || '').trim(),
    },
  }
}

function groupBy<T>(items: T[], keyFn: (item: T) => string) {
  return items.reduce<Record<string, T[]>>((groups, item) => {
    const key = keyFn(item)
    groups[key] = groups[key] ? [...groups[key], item] : [item]
    return groups
  }, {})
}

function getMonthOptions(data: AppData) {
  return Array.from(
    new Set(
      [
        ...data.payments.map((payment) => payment.month),
        ...data.expenses.map((expense) => expense.month),
        ...(data.memberships ?? []).map((membership) => membership.purchaseDate.slice(0, 7)),
        ...(data.membershipRedemptions ?? []).map((redemption) => redemption.visitDate.slice(0, 7)),
        todayIso.slice(0, 7),
      ].filter((month) => month && month !== 'Без даты'),
    ),
  ).sort()
}

function getDashboardStats(data: AppData, month: string) {
  const monthPayments = data.payments.filter((payment) => payment.month === month && payment.cash)
  const monthAppointments = data.appointments.filter((appointment) => appointment.date.startsWith(month))
  const monthExpenses = data.expenses.filter((expense) => expense.month === month)
  const allMembershipRedemptions = data.membershipRedemptions ?? []
  const monthMembershipRedemptions = allMembershipRedemptions.filter(
    (redemption) => !redemption.reversedAt && redemption.visitDate.startsWith(month),
  )
  const finance = calculateFinanceMonth(data, month)
  const { income, expenses, manualExpenses, guestMasterExpenses, guestMasterReports, profit } = finance
  const openDeals = data.deals.filter((deal) => isOpenDealWithAppointment(deal, appointmentForDeal(deal, data.appointments)))
  const overdueDeals = openDeals.filter((deal) => deal.expectedReadyDate < todayIso).length
  const notifyDeals = openDeals.filter((deal) => deal.status === 'Готово к выдаче').length
  const readyDeals = openDeals.filter((deal) => deal.status === 'Готово к выдаче' || deal.status === 'Клиент оповещен').length
  const readinessAttention = data.appointments.filter((appointment) =>
    needsReadinessAttentionForAppointment(appointment, data.deals),
  ).length
  const expenseCategoryMap = monthExpenses.reduce<Record<string, number>>((acc, expense) => {
    acc[expense.category] = (acc[expense.category] ?? 0) + expense.amount
    return acc
  }, {})
  if (guestMasterExpenses > 0) expenseCategoryMap['Доли приглашенных мастеров'] = guestMasterExpenses

  const monthMembershipSales = (data.memberships ?? []).filter(
    (membership) => membership.purchaseDate.startsWith(month),
  )
  const activeMemberships = (data.memberships ?? []).filter(
    (membership) => getMembershipStatus(membership, allMembershipRedemptions, todayIso) === 'Активен',
  )
  const membershipStats = {
    sold: monthMembershipSales.length,
    received: monthMembershipSales.reduce((sum, membership) => sum + membership.purchaseAmount, 0),
    visits: monthMembershipRedemptions.length,
    active: activeMemberships.length,
    obligations: activeMemberships.reduce(
      (sum, membership) => sum + remainingMembershipObligation(membership, allMembershipRedemptions),
      0,
    ),
    unlimitedActive: activeMemberships.filter((membership) => membership.kind === 'unlimited').length,
  }

  const staff = teachers.reduce(
    (acc, teacher) => {
      const appointments = monthAppointments.filter(
        (appointment) => appointment.teacher === teacher && appointment.status !== 'Бронь',
      )
      const payments = monthPayments.filter((payment) => payment.teacher === teacher)
      const teacherDeals = data.deals.filter((deal) => deal.teacher === teacher)
      const teacherOpenDeals = teacherDeals.filter((deal) =>
        isOpenDealWithAppointment(deal, appointmentForDeal(deal, data.appointments)),
      )
      const teacherIncome = payments.reduce((sum, payment) => sum + payment.amount, 0)
      const membershipValue = monthMembershipRedemptions
        .filter((redemption) => redemption.teacher === teacher)
        .reduce((sum, redemption) => sum + redemption.allocatedValue, 0)
      const teacherExpenses = monthExpenses
        .filter((expense) => expenseBelongsToTeacher(expense.paidBy, teacher))
        .reduce((sum, expense) => sum + expense.amount, 0)
      const checks = payments.filter((payment) => payment.amount > 0).length
      acc[teacher] = {
        sessions: appointments.length,
        openDeals: teacherOpenDeals.length,
        closedDeals: teacherDeals.filter((deal) => !isOpenDealWithAppointment(deal, appointmentForDeal(deal, data.appointments))).length,
        income: teacherIncome,
        membershipValue,
        expenses: teacherExpenses,
        profit: teacherIncome - teacherExpenses,
        averageCheck: checks ? teacherIncome / checks : 0,
        workDays: new Set(appointments.map((appointment) => appointment.date)).size,
        waitingItems: teacherOpenDeals.filter((deal) => deal.status.includes('Ожидание') || deal.status.includes('работ')).length,
        notifyDeals: teacherOpenDeals.filter((deal) => deal.status === 'Готово к выдаче').length,
        overdueDeals: teacherOpenDeals.filter((deal) => deal.expectedReadyDate < todayIso).length,
      }
      return acc
    },
    {} as Record<Teacher, {
      sessions: number
      openDeals: number
      closedDeals: number
      income: number
      membershipValue: number
      expenses: number
      profit: number
      averageCheck: number
      workDays: number
      waitingItems: number
      notifyDeals: number
      overdueDeals: number
    }>,
  )

  return {
    income,
    expenses,
    manualExpenses,
    guestMasterExpenses,
    guestMasterReports,
    membershipStats,
    profit,
    margin: income ? profit / income : 0,
    appointmentCount: monthAppointments.length,
    openDeals: openDeals.length,
    overdueDeals,
    notifyDeals,
    readinessAttention,
    readyDeals,
    expenseCategories: Object.entries(expenseCategoryMap).sort((a, b) => b[1] - a[1]),
    monthExpenses: [...monthExpenses].sort((a, b) => b.date.localeCompare(a.date)),
    staff,
  }
}

export default App
