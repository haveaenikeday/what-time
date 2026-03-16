import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

export function formatPhone(phone: string): string {
  const digits = phone.replace(/[^\d+]/g, '')
  if (digits.length <= 4) return digits
  return digits
}

export function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str
  return str.slice(0, maxLen) + '...'
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return '-'
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

export function formatRelativeTime(iso: string | null): string {
  if (!iso) return '-'
  const date = new Date(iso)
  const now = new Date()
  const diffMs = date.getTime() - now.getTime()
  const diffMins = Math.round(diffMs / 60000)

  if (Math.abs(diffMins) < 1) return 'just now'
  if (diffMins > 0 && diffMins < 60) return `in ${diffMins}m`
  if (diffMins < 0 && diffMins > -60) return `${Math.abs(diffMins)}m ago`

  const diffHours = Math.round(diffMins / 60)
  if (diffHours > 0 && diffHours < 24) return `in ${diffHours}h`
  if (diffHours < 0 && diffHours > -24) return `${Math.abs(diffHours)}h ago`

  return date.toLocaleDateString()
}
