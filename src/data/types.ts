export type Teacher = 'Алина' | 'Настя' | 'Другое'

export type StaffRole = 'admin' | 'teacher'

export type StaffProfile = {
  id: string
  email: string
  displayName: string
  teacher: Teacher
  role: StaffRole
  isActive: boolean
}

export type GuestMaster = {
  id: string
  name: string
  defaultRatePercent: number
  isActive: boolean
}

export type MembershipKind = 'sessions' | 'balance' | 'unlimited'

export type PaymentMethod = 'cash' | 'membership'

export type Membership = {
  id: string
  clientId: string
  clientName: string
  phone?: string
  whatsapp?: string
  telegram?: string
  instagram?: string
  name: string
  kind: MembershipKind
  purchasePaymentId?: string
  purchaseDate: string
  expiresAt: string
  purchaseAmount: number
  initialSessions?: number
  initialBalance?: number
  allowedServiceTypes: string[]
  comment?: string
}

export type MembershipRedemption = {
  id: string
  membershipId: string
  appointmentId: string
  visitDate: string
  redeemedAt: string
  reversedAt?: string
  sessionsUsed: number
  balanceUsed: number
  allocatedValue: number
  teacher: Teacher
  guestMasterId?: string
  guestMasterName?: string
  guestMasterRatePercent?: number
}

export type DealStatus =
  | 'Бронь'
  | 'Посещение'
  | 'Изделие в работе'
  | 'Ожидание изделия'
  | 'Роспись после первого обжига'
  | 'Готово к выдаче'
  | 'Клиент оповещен'
  | 'Изделие выдано'
  | 'Сделка закрыта'

export type AppointmentStatus = DealStatus | 'Оплата' | 'Проведен' | 'Закрыт'

export type Client = {
  id: string
  name: string
  phone?: string
  whatsapp?: string
  telegram?: string
  instagram?: string
}

export type Appointment = {
  id: string
  clientId: string
  clientName: string
  phone?: string
  whatsapp?: string
  telegram?: string
  instagram?: string
  date: string
  time: string
  durationMinutes: number
  peopleCount?: number
  serviceType: string
  item: string
  amount: number
  paid: boolean
  cash: boolean
  teacher: Teacher
  sourceTeacher?: string
  guestMasterId?: string
  guestMasterName?: string
  guestMasterRatePercent?: number
  paymentMethod?: PaymentMethod
  membershipId?: string
  membershipName?: string
  membershipChargeAmount?: number
  status: AppointmentStatus
  comment?: string
  photos?: ProductPhoto[]
  dealId?: string
}

export type ProductPhoto = {
  id: string
  path: string
  url: string
  uploadedAt: string
  width: number
  height: number
  size: number
}

export type DealHistory = {
  date: string
  status: DealStatus
  note?: string
}

export type Deal = {
  id: string
  appointmentId: string
  clientId: string
  clientName: string
  visitDate: string
  teacher: Teacher
  status: DealStatus
  expectedReadyDate: string
  nextStep: string
  amount: number
  item: string
  comment?: string
  history: DealHistory[]
}

export type Payment = {
  id: string
  appointmentId?: string
  date: string
  month: string
  type: string
  clientName: string
  status: string
  amount: number
  teacher: Teacher
  sourceTeacher?: string
  service: string
  cash: boolean
  source: string
  comment?: string
}

export type Expense = {
  id: string
  date: string
  month: string
  paidBy: string
  category: string
  subcategory: string
  description: string
  amount: number
  type: string
  source: string
  comment?: string
}

export type FixedExpense = {
  id: string
  category: string
  description: string
  monthlyAmount: number
  comment?: string
}

export type Certificate = {
  id: string
  number: string
  purchasePaymentId?: string
  clientName: string
  purchaseDate: string
  expiresAt: string
  amount: number
  teacher?: Teacher
  usedAt?: string
  comment?: string
}

export type SeedMeta = {
  generatedAt: string
  sourceWorkbook: string
  incomeRows: number
  expenseRows: number
  fixedExpenseRows: number
}

export type AppData = {
  meta: SeedMeta
  clients: Client[]
  appointments: Appointment[]
  deals: Deal[]
  payments: Payment[]
  expenses: Expense[]
  fixedExpenses: FixedExpense[]
  certificates?: Certificate[]
  guestMasters?: GuestMaster[]
  memberships?: Membership[]
  membershipRedemptions?: MembershipRedemption[]
  staff: Teacher[]
  serviceTypes: string[]
}

export type StatisticsData = Pick<AppData, 'appointments' | 'payments' | 'expenses' | 'fixedExpenses'> & {
  memberships: Membership[]
  membershipRedemptions: MembershipRedemption[]
}
