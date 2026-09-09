import 'server-only'
import { createHash, timingSafeEqual } from 'node:crypto'

/** Cookie set once the visitor enters the demo passcode. */
export const DEMO_COOKIE = 'demo_unlocked'

/** Seven days; long enough to survive the talk without re-entering. */
export const DEMO_COOKIE_MAX_AGE = 60 * 60 * 24 * 7

function configuredPasscode(): string | undefined {
  const value = process.env.DEMO_PASSCODE?.trim()
  return value ? value : undefined
}

/** Whether a passcode is configured at all. When it is not, the demo is open. */
export function isDemoLocked(): boolean {
  return configuredPasscode() !== undefined
}

/** Value stored in the cookie: a digest of the passcode, never the passcode itself. */
export function demoCookieValue(): string {
  const passcode = configuredPasscode() ?? ''
  return createHash('sha256').update(`demo:${passcode}`).digest('hex')
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB)
}

/** True when no passcode is configured, or the cookie carries the expected digest. */
export function isDemoUnlocked(cookieValue: string | undefined | null): boolean {
  if (!isDemoLocked()) return true
  if (!cookieValue) return false
  return safeEqual(cookieValue, demoCookieValue())
}

/** Compare a submitted passcode against the configured one. */
export function isPasscodeValid(submitted: string): boolean {
  const expected = configuredPasscode()
  if (!expected) return true
  return safeEqual(submitted.trim(), expected)
}

/** Pull one cookie out of a raw `Cookie` header. */
export function readCookieFromHeader(
  header: string | string[] | undefined | null,
  name: string,
): string | undefined {
  const raw = Array.isArray(header) ? header.join('; ') : header
  if (!raw) return undefined
  for (const part of raw.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return decodeURIComponent(rest.join('='))
  }
  return undefined
}
