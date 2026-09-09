import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import { cookies } from 'next/headers'

import { Director } from '@/components/demo/director'
import { UnlockForm } from '@/components/demo/unlock-form'
import { DEMO_COOKIE, isDemoUnlocked } from '@/lib/demo-auth'

import './demo.css'

const inter = Inter({ subsets: ['latin'], display: 'swap' })

export const metadata: Metadata = {
  title: 'Live Director',
  description: 'Direct a continuous AI video stream with live prompts.',
  robots: { index: false, follow: false },
}

export default async function DemoPage() {
  const store = await cookies()
  const unlocked = isDemoUnlocked(store.get(DEMO_COOKIE)?.value)

  return (
    <div className={inter.className}>
      {unlocked ? <Director /> : <UnlockForm />}
    </div>
  )
}
