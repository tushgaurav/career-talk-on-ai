'use client'

import { useActionState } from 'react'

import { unlockDemo, type UnlockState } from '@/app/demo/actions'

const initialState: UnlockState = {}

export function UnlockForm() {
  const [state, formAction, pending] = useActionState(unlockDemo, initialState)

  return (
    <main className="demo-root flex min-h-svh items-center justify-center px-4">
      <form action={formAction} className="w-full max-w-xs">
        <h1 className="text-xl font-semibold">Live Director</h1>
        <p className="mt-1 text-sm text-neutral-400">Enter the passcode to open the demo.</p>

        <label htmlFor="passcode" className="mt-6 block text-sm font-medium">
          Passcode
        </label>
        <input
          id="passcode"
          name="passcode"
          type="password"
          autoComplete="off"
          autoFocus
          aria-invalid={state.error ? true : undefined}
          className="mt-2 h-10 w-full rounded-md border border-neutral-800 bg-neutral-900 px-3 text-sm outline-none focus:border-neutral-500 aria-invalid:border-red-500"
        />
        {state.error ? (
          <p role="alert" className="mt-2 text-sm text-red-400">
            {state.error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={pending}
          className="mt-4 h-10 w-full rounded-md bg-white text-sm font-medium text-black hover:bg-neutral-200 disabled:opacity-50"
        >
          {pending ? 'Checking…' : 'Continue'}
        </button>
      </form>
    </main>
  )
}
