'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import {
  DEMO_COOKIE,
  DEMO_COOKIE_MAX_AGE,
  demoCookieValue,
  isPasscodeValid,
} from '@/lib/demo-auth'

export type UnlockState = { error?: string }

export async function unlockDemo(
  _prev: UnlockState,
  formData: FormData,
): Promise<UnlockState> {
  const submitted = String(formData.get('passcode') ?? '')

  if (!submitted.trim()) {
    return { error: 'Enter the passcode to continue.' }
  }

  if (!isPasscodeValid(submitted)) {
    return { error: 'That passcode is not right.' }
  }

  const store = await cookies()
  store.set(DEMO_COOKIE, demoCookieValue(), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: DEMO_COOKIE_MAX_AGE,
  })

  redirect('/demo')
}
